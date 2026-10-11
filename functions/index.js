/**
 * StoryByte Studio's backend: connecting a user's YouTube channel and
 * Facebook Pages / Instagram accounts, and the dashboard's "Run now".
 * Served at /api/** on the Hosting domain (firebase.json rewrite).
 *
 *   POST /api/oauth/youtube/start   -> { url }  (Authorization: Bearer <Firebase ID token>)
 *   GET  /api/oauth/youtube/callback
 *   POST /api/oauth/meta/start      -> { url }
 *   GET  /api/oauth/meta/callback
 *   POST /api/connections/delete    { id }
 *   POST /api/run-now               { profileId, kind: 'short' | 'long' }
 *
 * Tokens are encrypted (lib/crypto.js) into tokens/{uid}__{connId}, which no
 * client can read; users/{uid}/connections/{connId} holds only what the
 * dashboard shows. The browser never sees a platform token.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const functionsV1 = require('firebase-functions/v1');
const admin = require('firebase-admin');

const { encrypt } = require('./lib/crypto');
const { makeState, readState } = require('./lib/state');
const youtube = require('./lib/youtube');
const meta = require('./lib/meta');

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const GOOGLE_CLIENT_ID = defineString('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET');
const META_APP_ID = defineString('META_APP_ID');
const META_APP_SECRET = defineSecret('META_APP_SECRET');
const TOKEN_KEY = defineSecret('TOKEN_KEY');
const STATE_SECRET = defineSecret('STATE_SECRET');
// The site's public origin, e.g. https://storybyte-studio.web.app — the
// OAuth redirect URIs registered with Google and Meta live under it.
const PUBLIC_URL = defineString('PUBLIC_URL');

const MANUAL_RUNS_PER_DAY = 3;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function requireUser(req) {
  const token = String(req.get('authorization') || '').replace(/^Bearer /i, '');
  if (!token) throw new HttpError(401, 'sign in first');
  try {
    return await admin.auth().verifyIdToken(token);
  } catch {
    throw new HttpError(401, 'your session expired — sign in again');
  }
}

const redirectUri = (platform) => `${PUBLIC_URL.value().replace(/\/$/, '')}/api/oauth/${platform}/callback`;
const googleOpts = () => ({ clientId: GOOGLE_CLIENT_ID.value(), clientSecret: GOOGLE_CLIENT_SECRET.value(), redirectUri: redirectUri('youtube') });

/** Back to the dashboard with a one-line result for it to show. */
function finish(res, params) {
  res.redirect(303, `${PUBLIC_URL.value().replace(/\/$/, '')}/?${new URLSearchParams(params)}`);
}

async function saveConnection(uid, connId, metaData, credentials) {
  const batch = db.batch();
  batch.set(db.doc(`users/${uid}/connections/${connId}`), {
    ...metaData, status: 'ok', statusReason: FieldValue.delete(), connectedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(db.doc(`tokens/${uid}__${connId}`), { enc: encrypt(credentials), updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
}

const routes = {
  'POST /oauth/youtube/start': async (req) => {
    const user = await requireUser(req);
    return { url: youtube.authUrl(googleOpts(), makeState({ uid: user.uid, p: 'youtube' })) };
  },

  'GET /oauth/youtube/callback': async (req, res) => {
    const state = readState(req.query.state);
    if (!state || state.p !== 'youtube') return finish(res, { error: 'That sign-in link expired — try connecting again.' });
    if (req.query.error) return finish(res, { error: `YouTube was not connected (${req.query.error}).` });
    const { refreshToken, channel } = await youtube.channelFor(googleOpts(), String(req.query.code || ''));
    await saveConnection(state.uid, `yt_${channel.id}`,
      { platform: 'youtube', name: channel.title, externalId: channel.id, picture: channel.thumbnail },
      { refreshToken });
    return finish(res, { connected: `YouTube: ${channel.title}` });
  },

  'POST /oauth/meta/start': async (req) => {
    const user = await requireUser(req);
    return { url: meta.authUrl({ appId: META_APP_ID.value(), redirectUri: redirectUri('meta'), state: makeState({ uid: user.uid, p: 'meta' }) }) };
  },

  'GET /oauth/meta/callback': async (req, res) => {
    const state = readState(req.query.state);
    if (!state || state.p !== 'meta') return finish(res, { error: 'That sign-in link expired — try connecting again.' });
    if (req.query.error) return finish(res, { error: `Facebook was not connected (${req.query.error_description || req.query.error}).` });
    const pages = await meta.pagesFor({
      appId: META_APP_ID.value(), appSecret: META_APP_SECRET.value(), redirectUri: redirectUri('meta'), code: String(req.query.code || ''),
    });
    if (!pages.length) return finish(res, { error: 'No Facebook Pages were shared. Connect again and select at least one Page.' });
    const names = [];
    for (const page of pages) {
      await saveConnection(state.uid, `fb_${page.id}`, { platform: 'facebook', name: page.name, externalId: page.id },
        { pageToken: page.pageToken });
      names.push(page.name);
      if (page.instagram) {
        await saveConnection(state.uid, `ig_${page.instagram.id}`,
          { platform: 'instagram', name: `@${page.instagram.username || page.instagram.id}`, externalId: page.instagram.id, pageId: page.id },
          { pageToken: page.pageToken });
        names.push(`@${page.instagram.username}`);
      }
    }
    return finish(res, { connected: names.join(', ') });
  },

  'POST /connections/delete': async (req) => {
    const user = await requireUser(req);
    const id = String(req.body?.id || '');
    if (!/^(yt|fb|ig)_[\w-]+$/.test(id)) throw new HttpError(400, 'unknown connection');
    await db.doc(`tokens/${user.uid}__${id}`).delete();
    await db.doc(`users/${user.uid}/connections/${id}`).delete();
    // Stop profiles from publishing to it.
    const profiles = await db.collection(`users/${user.uid}/profiles`).get();
    await Promise.all(profiles.docs.map((p) => {
      const targets = p.data().targets || {};
      const cleared = Object.fromEntries(Object.entries(targets).filter(([, v]) => v !== id));
      return Object.keys(cleared).length === Object.keys(targets).length ? null : p.ref.update({ targets: cleared });
    }));
    return { ok: true };
  },

  'POST /run-now': async (req) => {
    const user = await requireUser(req);
    const profileId = String(req.body?.profileId || '');
    const kind = req.body?.kind === 'long' ? 'long' : 'short';
    if (!/^[\w-]{1,100}$/.test(profileId)) throw new HttpError(400, 'unknown profile');
    const profile = await db.doc(`users/${user.uid}/profiles/${profileId}`).get();
    if (!profile.exists) throw new HttpError(404, 'profile not found');
    const since = admin.firestore.Timestamp.fromMillis(Date.now() - 86400e3);
    const recent = await db.collection(`users/${user.uid}/jobs`).where('source', '==', 'manual').where('createdAt', '>', since).count().get();
    if (recent.data().count >= MANUAL_RUNS_PER_DAY) throw new HttpError(429, `"Run now" is limited to ${MANUAL_RUNS_PER_DAY} times a day`);
    const ref = await db.collection(`users/${user.uid}/jobs`).add({
      uid: user.uid, profileId, kind, source: 'manual', status: 'queued', attempts: 0, createdAt: FieldValue.serverTimestamp(),
    });
    return { jobId: ref.id };
  },
};

exports.api = onRequest(
  { region: 'us-central1', secrets: [GOOGLE_CLIENT_SECRET, META_APP_SECRET, TOKEN_KEY, STATE_SECRET], timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    const route = routes[`${req.method} ${req.path.replace(/^\/api/, '').replace(/\/$/, '')}`];
    if (!route) return res.status(404).json({ error: 'not found' });
    try {
      const out = await route(req, res);
      if (!res.headersSent) res.json(out);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      const message = status === 500 ? 'something went wrong — please try again' : e.message;
      if (req.method === 'GET') return finish(res, { error: status === 500 ? `Could not connect: ${e.message}`.slice(0, 300) : message });
      res.status(status).json({ error: message });
    }
  },
);

// A deleted Firebase account takes its data and stored tokens with it.
exports.cleanupUser = functionsV1.auth.user().onDelete(async (user) => {
  const tokens = await db.collection('tokens')
    .where(admin.firestore.FieldPath.documentId(), '>=', `${user.uid}__`)
    .where(admin.firestore.FieldPath.documentId(), '<', `${user.uid}__`).get();
  await Promise.all(tokens.docs.map((d) => d.ref.delete()));
  await db.recursiveDelete(db.doc(`users/${user.uid}`));
});
