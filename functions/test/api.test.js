/**
 * The /api routes end to end, with Firebase, Google and Meta faked: who can
 * do what, and where tokens end up.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const Module = require('module');

process.env.TOKEN_KEY = crypto.randomBytes(32).toString('base64');
process.env.STATE_SECRET = 'state-secret';
const ENV = { PUBLIC_URL: 'https://studio.example', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec', META_APP_ID: 'mid', META_APP_SECRET: 'msec' };

// ---- fakes ----
const store = {};
const ref = (p) => ({
  id: p.split('/').pop(), path: p,
  get: async () => ({ exists: !!store[p], data: () => store[p] }),
  update: async (d) => { store[p] = { ...store[p], ...d }; },
  delete: async () => { delete store[p]; },
});
const coll = (p) => ({
  filters: [],
  where(f, op, v) { this.filters.push([f, op, v]); return this; },
  get: async () => ({ docs: Object.keys(store).filter((k) => k.startsWith(`${p}/`) && k.split('/').length === p.split('/').length + 1)
    .map((k) => ({ ref: ref(k), data: () => store[k] })) }),
  count() { return { get: async () => ({ data: () => ({ count: Object.keys(store).filter((k) => k.startsWith(`${p}/`) && store[k].source === 'manual').length }) }) }; },
  add: async (d) => { const id = `job${Object.keys(store).length}`; store[`${p}/${id}`] = d; return { id }; },
});
const db = {
  doc: ref, collection: coll,
  batch: () => {
    const ops = [];
    return { set: (r, d) => ops.push([r.path, d]), commit: async () => ops.forEach(([p, d]) => { store[p] = { ...(store[p] || {}), ...JSON.parse(JSON.stringify(d)) }; }) };
  },
};
const fakeAdmin = {
  initializeApp() {},
  firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => 'TS', delete: () => undefined }, Timestamp: { fromMillis: (ms) => ms }, FieldPath: { documentId: () => '__id' } }),
  auth: () => ({ verifyIdToken: async (t) => { if (!t.startsWith('id:')) throw new Error('bad'); return { uid: t.slice(3) }; } }),
};
const fakeGoogle = { google: {
  auth: { OAuth2: class {
    constructor(id, secret, redirect) { this.redirect = redirect; }
    generateAuthUrl(o) { return `https://accounts.google.com/o/oauth2/auth?redirect_uri=${encodeURIComponent(this.redirect)}&state=${o.state}&scope=${o.scope.join('+')}`; }
    async getToken(code) { return { tokens: { refresh_token: `RT-${code}`, scope: 'https://www.googleapis.com/auth/youtube.upload' } }; }
    setCredentials() {}
  } },
  youtube: () => ({ channels: { list: async () => ({ data: { items: [{ id: 'UC9', snippet: { title: 'My Channel', thumbnails: {} } }] } }) } }),
} };
let handler;
const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'firebase-admin') return fakeAdmin;
  if (req === 'googleapis') return fakeGoogle;
  if (req === 'firebase-functions/v2/https') return { onRequest: (opts, fn) => { handler = fn; return fn; } };
  if (req === 'firebase-functions/params') return { defineSecret: (n) => ({ value: () => ENV[n] }), defineString: (n) => ({ value: () => ENV[n] }) };
  if (req === 'firebase-functions/v1') return { auth: { user: () => ({ onDelete: (fn) => fn }) } };
  return orig.call(this, req, ...rest);
};
require('../index');
const { decrypt } = require('../lib/crypto');

const result = (location) => Object.fromEntries(new URL(location).searchParams);

function call(method, path, { token, body, query = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      headersSent: false, statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.headersSent = true; resolve({ status: this.statusCode, body: b }); },
      redirect(c, url) { this.headersSent = true; resolve({ status: c, location: url }); },
    };
    handler({ method, path, query, body, get: (h) => (h === 'authorization' && token ? `Bearer ${token}` : '') }, res);
  });
}

test('starting a connection needs a signed-in user', async () => {
  assert.strictEqual((await call('POST', '/api/oauth/youtube/start')).status, 401);
  assert.strictEqual((await call('POST', '/api/oauth/youtube/start', { token: 'forged' })).status, 401);
});

test('YouTube: start -> callback stores the channel and an encrypted refresh token for that user', async () => {
  const start = await call('POST', '/api/oauth/youtube/start', { token: 'id:alice' });
  const url = new URL(start.body.url);
  assert.strictEqual(url.searchParams.get('redirect_uri'), 'https://studio.example/api/oauth/youtube/callback');
  const done = await call('GET', '/api/oauth/youtube/callback', { query: { code: 'C1', state: url.searchParams.get('state') } });
  assert.match(done.location, /^https:\/\/studio\.example\/\?connected=YouTube/);
  assert.strictEqual(store['users/alice/connections/yt_UC9'].name, 'My Channel');
  assert.ok(!JSON.stringify(store['users/alice/connections/yt_UC9']).includes('RT-C1'), 'no token in the client-readable doc');
  assert.deepStrictEqual(decrypt(store['tokens/alice__yt_UC9'].enc), { refreshToken: 'RT-C1' });
});

test('a callback with a bad state stores nothing', async () => {
  const before = Object.keys(store).length;
  const done = await call('GET', '/api/oauth/youtube/callback', { query: { code: 'C2', state: 'tampered.state' } });
  assert.match(result(done.location).error, /That sign-in link expired/);
  assert.strictEqual(Object.keys(store).length, before);
});

test('Meta: every Page and its Instagram account become connections', async () => {
  global.fetch = async (u) => {
    const url = new URL(u);
    if (url.pathname.endsWith('/oauth/access_token')) return Response.json({ access_token: 'T' });
    return Response.json({ data: [{ id: 'P1', name: 'Bhakti Page', access_token: 'PT1', instagram_business_account: { id: 'IG7', username: 'bhakti' } }] });
  };
  const start = await call('POST', '/api/oauth/meta/start', { token: 'id:alice' });
  const state = new URL(start.body.url).searchParams.get('state');
  const done = await call('GET', '/api/oauth/meta/callback', { query: { code: 'M', state } });
  assert.strictEqual(result(done.location).connected, 'Bhakti Page, @bhakti');
  assert.strictEqual(store['users/alice/connections/fb_P1'].platform, 'facebook');
  assert.strictEqual(store['users/alice/connections/ig_IG7'].externalId, 'IG7');
  assert.deepStrictEqual(decrypt(store['tokens/alice__ig_IG7'].enc), { pageToken: 'PT1' });
});

test('a state issued for YouTube cannot finish a Meta login', async () => {
  const start = await call('POST', '/api/oauth/youtube/start', { token: 'id:bob' });
  const state = new URL(start.body.url).searchParams.get('state');
  const done = await call('GET', '/api/oauth/meta/callback', { query: { code: 'M', state } });
  assert.ok(result(done.location).error);
  assert.ok(!Object.keys(store).some((k) => k.startsWith('users/bob')));
});

test('disconnecting deletes the token and clears it from profiles', async () => {
  store['users/alice/profiles/p1'] = { name: 'x', targets: { youtube: 'yt_UC9', facebook: 'fb_P1' } };
  const res = await call('POST', '/api/connections/delete', { token: 'id:alice', body: { id: 'yt_UC9' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(store['tokens/alice__yt_UC9'], undefined);
  assert.strictEqual(store['users/alice/connections/yt_UC9'], undefined);
  assert.deepStrictEqual(store['users/alice/profiles/p1'].targets, { facebook: 'fb_P1' });
});

test('run-now queues a job for the caller\'s own profile, up to 3 a day', async () => {
  assert.strictEqual((await call('POST', '/api/run-now', { token: 'id:mallory', body: { profileId: 'p1' } })).status, 404);
  for (let i = 0; i < 3; i++) {
    const r = await call('POST', '/api/run-now', { token: 'id:alice', body: { profileId: 'p1', kind: 'short' } });
    assert.ok(r.body.jobId, JSON.stringify(r));
  }
  assert.strictEqual((await call('POST', '/api/run-now', { token: 'id:alice', body: { profileId: 'p1' } })).status, 429);
});

test('unknown routes 404', async () => {
  assert.strictEqual((await call('GET', '/api/nope')).status, 404);
});
