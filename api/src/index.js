/**
 * StoryByte Studio's API, a Cloudflare Worker (free plan): connecting a
 * user's YouTube channel and Facebook Pages / Instagram accounts, the
 * dashboard's "Run now", and deleting an account's data.
 *
 *   POST /oauth/youtube/start   -> { url }   (Authorization: Bearer <Firebase ID token>)
 *   GET  /oauth/youtube/callback
 *   POST /oauth/meta/start      -> { url }
 *   GET  /oauth/meta/callback
 *   POST /connections/delete    { id }
 *   POST /run-now               { profileId, kind: 'short' | 'long' }
 *   POST /account/delete
 *
 * Tokens are encrypted (crypto.js) into tokens/{uid}__{connId}, which no
 * client can read; users/{uid}/connections/{connId} holds only what the
 * dashboard shows. The browser never sees a platform token.
 *
 * Secrets: FIREBASE_SERVICE_ACCOUNT, TOKEN_KEY, STATE_SECRET,
 * GOOGLE_CLIENT_SECRET, META_APP_SECRET. Vars: GOOGLE_CLIENT_ID,
 * META_APP_ID, PUBLIC_URL (the dashboard's origin).
 */
import { Firestore, SERVER_TIME, DELETE } from './firestore.js';
import { verifyIdToken } from './google-auth.js';
import { encrypt } from './crypto.js';
import { makeState, readState } from './state.js';
import * as youtube from './youtube.js';
import * as meta from './meta.js';

const MANUAL_RUNS_PER_DAY = 3;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function context(request, env) {
  const sa = typeof env.FIREBASE_SERVICE_ACCOUNT === 'string' ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) : env.FIREBASE_SERVICE_ACCOUNT;
  const origin = new URL(request.url).origin;
  return {
    env,
    db: new Firestore(sa),
    projectId: sa.project_id,
    site: String(env.PUBLIC_URL || '').replace(/\/$/, ''),
    redirectUri: (platform) => `${origin}/oauth/${platform}/callback`,
  };
}

async function requireUser(request, ctx) {
  const token = String(request.headers.get('authorization') || '').replace(/^Bearer /i, '');
  if (!token) throw new HttpError(401, 'sign in first');
  const uid = await verifyIdToken(token, ctx.projectId);
  if (!uid) throw new HttpError(401, 'your session expired — sign in again');
  return uid;
}

/** Back to the dashboard with a one-line result for it to show. */
const finish = (ctx, params) => Response.redirect(`${ctx.site}/?${new URLSearchParams(params)}`, 303);

function saveConnection(uid, connId, metaData, credentials, tokenKey) {
  return encrypt(credentials, tokenKey).then((enc) => [
    { set: `users/${uid}/connections/${connId}`, merge: true,
      data: { ...metaData, status: 'ok', statusReason: DELETE, connectedAt: SERVER_TIME } },
    { set: `tokens/${uid}__${connId}`, data: { enc, updatedAt: SERVER_TIME } },
  ]);
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');

const routes = {
  'POST /oauth/youtube/start': async (req, ctx) => {
    const uid = await requireUser(req, ctx);
    return { url: youtube.authUrl({ clientId: ctx.env.GOOGLE_CLIENT_ID, redirectUri: ctx.redirectUri('youtube'),
      state: await makeState({ uid, p: 'youtube' }, ctx.env.STATE_SECRET) }) };
  },

  'GET /oauth/youtube/callback': async (req, ctx) => {
    const q = new URL(req.url).searchParams;
    const state = await readState(q.get('state'), ctx.env.STATE_SECRET);
    if (!state || state.p !== 'youtube') return finish(ctx, { error: 'That sign-in link expired — try connecting again.' });
    if (q.get('error')) return finish(ctx, { error: `YouTube was not connected (${q.get('error')}).` });
    const { refreshToken, channel } = await youtube.channelFor({
      clientId: ctx.env.GOOGLE_CLIENT_ID, clientSecret: ctx.env.GOOGLE_CLIENT_SECRET, redirectUri: ctx.redirectUri('youtube'), code: q.get('code') || '',
    });
    await ctx.db.commit(await saveConnection(state.uid, `yt_${channel.id}`,
      { platform: 'youtube', name: channel.title, externalId: channel.id, picture: channel.thumbnail }, { refreshToken }, ctx.env.TOKEN_KEY));
    return finish(ctx, { connected: `YouTube: ${channel.title}` });
  },

  'POST /oauth/meta/start': async (req, ctx) => {
    const uid = await requireUser(req, ctx);
    return { url: meta.authUrl({ appId: ctx.env.META_APP_ID, redirectUri: ctx.redirectUri('meta'),
      state: await makeState({ uid, p: 'meta' }, ctx.env.STATE_SECRET) }) };
  },

  'GET /oauth/meta/callback': async (req, ctx) => {
    const q = new URL(req.url).searchParams;
    const state = await readState(q.get('state'), ctx.env.STATE_SECRET);
    if (!state || state.p !== 'meta') return finish(ctx, { error: 'That sign-in link expired — try connecting again.' });
    if (q.get('error')) return finish(ctx, { error: `Facebook was not connected (${q.get('error_description') || q.get('error')}).` });
    const pages = await meta.pagesFor({
      appId: ctx.env.META_APP_ID, appSecret: ctx.env.META_APP_SECRET, redirectUri: ctx.redirectUri('meta'), code: q.get('code') || '',
    });
    if (!pages.length) return finish(ctx, { error: 'No Facebook Pages were shared. Connect again and select at least one Page.' });
    const ops = [];
    const names = [];
    for (const page of pages) {
      ops.push(...await saveConnection(state.uid, `fb_${page.id}`, { platform: 'facebook', name: page.name, externalId: page.id },
        { pageToken: page.pageToken }, ctx.env.TOKEN_KEY));
      names.push(page.name);
      if (page.instagram) {
        ops.push(...await saveConnection(state.uid, `ig_${page.instagram.id}`,
          { platform: 'instagram', name: `@${page.instagram.username || page.instagram.id}`, externalId: page.instagram.id, pageId: page.id },
          { pageToken: page.pageToken }, ctx.env.TOKEN_KEY));
        names.push(`@${page.instagram.username}`);
      }
    }
    await ctx.db.commit(ops);
    return finish(ctx, { connected: names.join(', ') });
  },

  'POST /connections/delete': async (req, ctx, body) => {
    const uid = await requireUser(req, ctx);
    const id = String(body.id || '');
    if (!/^(yt|fb|ig)_[\w-]+$/.test(id)) throw new HttpError(400, 'unknown connection');
    const ops = [{ delete: `tokens/${uid}__${id}` }, { delete: `users/${uid}/connections/${id}` }];
    // Stop profiles from publishing to it.
    for (const p of await ctx.db.list(`users/${uid}/profiles`)) {
      const targets = p.data.targets || {};
      const kept = Object.fromEntries(Object.entries(targets).filter(([, v]) => v !== id));
      if (Object.keys(kept).length !== Object.keys(targets).length) ops.push({ set: `users/${uid}/profiles/${p.id}`, merge: true, data: { targets: kept } });
    }
    await ctx.db.commit(ops);
    return { ok: true };
  },

  'POST /run-now': async (req, ctx, body) => {
    const uid = await requireUser(req, ctx);
    const profileId = String(body.profileId || '');
    const kind = body.kind === 'long' ? 'long' : 'short';
    if (!/^[\w-]{1,100}$/.test(profileId)) throw new HttpError(400, 'unknown profile');
    if (!(await ctx.db.get(`users/${uid}/profiles/${profileId}`))) throw new HttpError(404, 'profile not found');
    const recent = await ctx.db.count(`users/${uid}`, 'jobs', [['source', '==', 'manual'], ['createdAt', '>', new Date(Date.now() - 86400e3)]]);
    if (recent >= MANUAL_RUNS_PER_DAY) throw new HttpError(429, `"Run now" is limited to ${MANUAL_RUNS_PER_DAY} times a day`);
    const jobId = randomId();
    await ctx.db.commit([{ set: `users/${uid}/jobs/${jobId}`, mustNotExist: true,
      data: { uid, profileId, kind, source: 'manual', status: 'queued', attempts: 0, createdAt: SERVER_TIME } }]);
    return { jobId };
  },

  // Deletes everything stored for the caller; the dashboard then deletes the
  // sign-in itself. Already-published videos stay on the user's channels.
  'POST /account/delete': async (req, ctx) => {
    const uid = await requireUser(req, ctx);
    const ops = [];
    for (const sub of ['connections', 'profiles', 'jobs', 'series']) {
      for (const d of await ctx.db.list(`users/${uid}/${sub}`)) {
        ops.push({ delete: `users/${uid}/${sub}/${d.id}` });
        if (sub === 'connections') ops.push({ delete: `tokens/${uid}__${d.id}` });
      }
    }
    ops.push({ delete: `users/${uid}` });
    await ctx.db.commit(ops);
    return { ok: true };
  },
};

function cors(ctx, response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', ctx.site || '*');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Vary', 'Origin');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const ctx = context(request, env);
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return cors(ctx, new Response(null, { status: 204 }));
    const route = routes[`${request.method} ${url.pathname.replace(/\/$/, '')}`];
    if (!route) return cors(ctx, Response.json({ error: 'not found' }, { status: 404 }));
    try {
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
      const out = await route(request, ctx, body || {});
      return out instanceof Response ? out : cors(ctx, Response.json(out));
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e.stack || e);
      if (request.method === 'GET') return finish(ctx, { error: `Could not connect: ${e.message}`.slice(0, 300) });
      return cors(ctx, Response.json({ error: status === 500 ? 'something went wrong — please try again' : e.message }, { status }));
    }
  },
};
