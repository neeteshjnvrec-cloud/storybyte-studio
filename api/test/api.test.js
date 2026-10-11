import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { setup } from './fake-google.js';
import api from '../src/index.js';

const require = createRequire(import.meta.url);
const TOKEN_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
process.env.TOKEN_KEY = TOKEN_KEY;
const { decrypt } = require('../../worker/src/crypto.js'); // the video worker must read what the API writes

const g = await setup();
globalThis.fetch = g.fetchImpl;
const env = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify(g.serviceAccount), TOKEN_KEY, STATE_SECRET: 'state-secret',
  GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec', META_APP_ID: 'mid', META_APP_SECRET: 'msec', PUBLIC_URL: 'https://studio.web.app',
};
const API = 'https://api.example.workers.dev';

async function call(method, path, { uid, token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = `Bearer ${await g.idToken(uid)}`;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await api.fetch(new Request(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  const location = res.headers.get('location');
  return { status: res.status, body: location ? null : await res.json().catch(() => null), location,
    result: location ? Object.fromEntries(new URL(location).searchParams) : null, cors: res.headers.get('access-control-allow-origin') };
}

test('starting a connection needs a valid Firebase sign-in for this project', async () => {
  assert.strictEqual((await call('POST', '/oauth/youtube/start')).status, 401);
  assert.strictEqual((await call('POST', '/oauth/youtube/start', { token: 'not.a.token' })).status, 401);
  const otherProject = await g.idToken('eve', { aud: 'someone-elses-project', iss: 'https://securetoken.google.com/someone-elses-project' });
  assert.strictEqual((await call('POST', '/oauth/youtube/start', { token: otherProject })).status, 401);
  const expired = await g.idToken('eve', { exp: Math.floor(Date.now() / 1000) - 10 });
  assert.strictEqual((await call('POST', '/oauth/youtube/start', { token: expired })).status, 401);
});

test('YouTube: start -> callback stores the channel and an encrypted refresh token for that user', async () => {
  const start = await call('POST', '/oauth/youtube/start', { uid: 'alice' });
  assert.strictEqual(start.cors, 'https://studio.web.app');
  const url = new URL(start.body.url);
  assert.strictEqual(url.searchParams.get('redirect_uri'), `${API}/oauth/youtube/callback`);
  assert.strictEqual(url.searchParams.get('access_type'), 'offline');
  g.setGoogleCode('C1', { access_token: 'AT', refresh_token: 'RT-C1', scope: 'https://www.googleapis.com/auth/youtube.upload' });
  const done = await call('GET', `/oauth/youtube/callback?code=C1&state=${url.searchParams.get('state')}`);
  assert.strictEqual(done.status, 303);
  assert.ok(done.location.startsWith('https://studio.web.app/?'));
  assert.strictEqual(done.result.connected, 'YouTube: Bhakti Kahaniyan');
  const conn = g.doc('users/alice/connections/yt_UC9');
  assert.strictEqual(conn.name, 'Bhakti Kahaniyan');
  assert.strictEqual(conn.status, 'ok');
  assert.ok(conn.connectedAt);
  assert.ok(!JSON.stringify(conn).includes('RT-C1'), 'no token in the client-readable doc');
  assert.deepStrictEqual(decrypt(g.doc('tokens/alice__yt_UC9').enc), { refreshToken: 'RT-C1' });
});

test('reconnecting clears an "expired" status', async () => {
  g.store['users/alice/connections/yt_UC9'].status = { stringValue: 'expired' };
  g.store['users/alice/connections/yt_UC9'].statusReason = { stringValue: 'invalid_grant' };
  const start = await call('POST', '/oauth/youtube/start', { uid: 'alice' });
  g.setGoogleCode('C2', { access_token: 'AT', refresh_token: 'RT-C2', scope: 'youtube.upload' });
  await call('GET', `/oauth/youtube/callback?code=C2&state=${new URL(start.body.url).searchParams.get('state')}`);
  const conn = g.doc('users/alice/connections/yt_UC9');
  assert.strictEqual(conn.status, 'ok');
  assert.strictEqual(conn.statusReason, undefined);
  assert.deepStrictEqual(decrypt(g.doc('tokens/alice__yt_UC9').enc), { refreshToken: 'RT-C2' });
});

test('a callback with a bad state stores nothing', async () => {
  const before = JSON.stringify(g.store);
  const done = await call('GET', '/oauth/youtube/callback?code=C1&state=tampered.state');
  assert.match(done.result.error, /That sign-in link expired/);
  assert.strictEqual(JSON.stringify(g.store), before);
});

test('Meta: every Page and its Instagram account become connections', async () => {
  g.setMetaPages([{ id: 'P1', name: 'Bhakti Page', access_token: 'PT1', instagram_business_account: { id: 'IG7', username: 'bhakti' } },
    { id: 'P2', name: 'Second Page', access_token: 'PT2' }]);
  const start = await call('POST', '/oauth/meta/start', { uid: 'alice' });
  const state = new URL(start.body.url).searchParams.get('state');
  const done = await call('GET', `/oauth/meta/callback?code=M&state=${state}`);
  assert.strictEqual(done.result.connected, 'Bhakti Page, @bhakti, Second Page');
  assert.strictEqual(g.doc('users/alice/connections/fb_P1').platform, 'facebook');
  assert.strictEqual(g.doc('users/alice/connections/ig_IG7').externalId, 'IG7');
  assert.deepStrictEqual(decrypt(g.doc('tokens/alice__ig_IG7').enc), { pageToken: 'PT1' });
  assert.deepStrictEqual(decrypt(g.doc('tokens/alice__fb_P2').enc), { pageToken: 'PT2' });
});

test('a state issued for YouTube cannot finish a Meta login', async () => {
  const start = await call('POST', '/oauth/youtube/start', { uid: 'bob' });
  const state = new URL(start.body.url).searchParams.get('state');
  const done = await call('GET', `/oauth/meta/callback?code=M&state=${state}`);
  assert.ok(done.result.error);
  assert.ok(!Object.keys(g.store).some((k) => k.startsWith('users/bob') || k.startsWith('tokens/bob')));
});

test('disconnecting deletes the token and clears it from profiles', async () => {
  g.put('users/alice/profiles/p1', { name: 'x', targets: { youtube: 'yt_UC9', facebook: 'fb_P1' } });
  const res = await call('POST', '/connections/delete', { uid: 'alice', body: { id: 'yt_UC9' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(g.doc('tokens/alice__yt_UC9'), undefined);
  assert.strictEqual(g.doc('users/alice/connections/yt_UC9'), undefined);
  assert.deepStrictEqual(g.doc('users/alice/profiles/p1').targets, { facebook: 'fb_P1' });
  assert.strictEqual(g.doc('users/alice/profiles/p1').name, 'x');
});

test("run-now queues a job for the caller's own profile, up to 3 a day", async () => {
  assert.strictEqual((await call('POST', '/run-now', { uid: 'mallory', body: { profileId: 'p1' } })).status, 404);
  for (let i = 0; i < 3; i++) {
    const r = await call('POST', '/run-now', { uid: 'alice', body: { profileId: 'p1', kind: i === 2 ? 'long' : 'short' } });
    assert.ok(r.body.jobId, JSON.stringify(r.body));
    const job = g.doc(`users/alice/jobs/${r.body.jobId}`);
    assert.strictEqual(job.status, 'queued');
    assert.strictEqual(job.kind, i === 2 ? 'long' : 'short');
    assert.ok(job.createdAt);
  }
  const fourth = await call('POST', '/run-now', { uid: 'alice', body: { profileId: 'p1' } });
  assert.strictEqual(fourth.status, 429);
});

test('deleting an account removes all its data and tokens, and nobody else\'s', async () => {
  g.put('users/carol/profiles/c1', { name: 'carol' });
  g.put('tokens/carol__fb_X', { enc: 'x' });
  const res = await call('POST', '/account/delete', { uid: 'alice' });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(Object.keys(g.store).filter((k) => k.includes('alice')), []);
  assert.ok(g.doc('users/carol/profiles/c1'));
  assert.ok(g.doc('tokens/carol__fb_X'));
});

test('CORS preflight and unknown routes', async () => {
  const pre = await api.fetch(new Request(`${API}/run-now`, { method: 'OPTIONS' }), env);
  assert.strictEqual(pre.status, 204);
  assert.strictEqual(pre.headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
  assert.strictEqual((await call('GET', '/nope')).status, 404);
});
