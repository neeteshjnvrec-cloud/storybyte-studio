/**
 * Fakes for the API tests: Google's token endpoint and Firebase signing
 * keys, the Firestore REST API (an in-memory store), YouTube and Meta.
 */
import { b64url, b64urlJson } from '../src/google-auth.js';

const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
const pem = (der) => `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(der)))}\n-----END PRIVATE KEY-----\n`;

export async function setup() {
  const project = 'studio-test';
  const saKeys = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify']);
  const idKeys = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify']);
  const idJwk = { ...(await crypto.subtle.exportKey('jwk', idKeys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const serviceAccount = { project_id: project, client_email: 'sa@studio-test.iam.gserviceaccount.com',
    private_key: pem(await crypto.subtle.exportKey('pkcs8', saKeys.privateKey)) };

  async function idToken(uid, overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64urlJson({ alg: 'RS256', kid: 'k1' })}.${b64urlJson({
      aud: project, iss: `https://securetoken.google.com/${project}`, sub: uid, iat: now, exp: now + 3600, ...overrides })}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', idKeys.privateKey, new TextEncoder().encode(unsigned));
    return `${unsigned}.${b64url(sig)}`;
  }

  // ---- in-memory Firestore, stored as decoded-enough REST values ----
  const store = {}; // path -> fields (REST encoding)
  const root = `projects/${project}/databases/(default)/documents/`;
  const rel = (name) => name.replace(root, '');
  const plain = (v) => {
    if (!v) return undefined;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)]));
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
    return null;
  };
  const doc = (path) => (store[path] ? Object.fromEntries(Object.entries(store[path]).map(([k, v]) => [k, plain(v)])) : undefined);
  const put = (path, obj) => {
    const enc = (v) => (typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) }
      : v && typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { nullValue: null });
    store[path] = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, enc(v)]));
  };
  const children = (collection) => Object.keys(store).filter((p) => p.startsWith(`${collection}/`) && p.split('/').length === collection.split('/').length + 1);

  const fetches = [];
  let googleTokens = {};
  let metaPages = [];

  async function fetchImpl(url, init = {}) {
    url = String(url);
    const u = new URL(url);
    fetches.push(`${init.method || 'GET'} ${u.host}${u.pathname}`);
    if (u.host === 'oauth2.googleapis.com') {
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer') return Response.json({ access_token: 'SA-TOKEN', expires_in: 3600 });
      if (form.get('grant_type') === 'authorization_code') return Response.json(googleTokens[form.get('code')] || { error: 'invalid_grant' }, { status: googleTokens[form.get('code')] ? 200 : 400 });
    }
    if (url.startsWith('https://www.googleapis.com/service_accounts/')) return Response.json({ keys: [idJwk] });
    if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/channels') {
      return Response.json({ items: [{ id: 'UC9', snippet: { title: 'Bhakti Kahaniyan', thumbnails: { default: { url: 'https://img' } } } }] });
    }
    if (u.host === 'firestore.googleapis.com') {
      if (init.headers?.Authorization !== 'Bearer SA-TOKEN') return Response.json({ error: { message: 'unauthenticated' } }, { status: 401 });
      const path = decodeURIComponent(u.pathname.replace('/v1/', ''));
      if (path.endsWith(':commit')) {
        const { writes } = JSON.parse(init.body);
        const next = { ...store };
        for (const w of writes) {
          if (w.delete) { delete next[rel(w.delete)]; continue; }
          const p = rel(w.update.name);
          if (w.currentDocument?.exists === false && next[p]) return Response.json({ error: { message: 'ALREADY_EXISTS' } }, { status: 409 });
          let fields = { ...w.update.fields };
          if (w.updateMask) {
            fields = { ...(next[p] || {}) };
            for (const f of w.updateMask.fieldPaths) {
              if (f in w.update.fields) fields[f] = w.update.fields[f];
              else delete fields[f];
            }
          }
          for (const t of w.updateTransforms || []) fields[t.fieldPath] = { timestampValue: new Date().toISOString() };
          next[p] = fields;
        }
        Object.keys(store).forEach((k) => delete store[k]);
        Object.assign(store, next);
        return Response.json({ writeResults: writes.map(() => ({})) });
      }
      if (path.endsWith(':runAggregationQuery')) {
        const parent = rel(path.replace(':runAggregationQuery', ''));
        const q = JSON.parse(init.body).structuredAggregationQuery.structuredQuery;
        const coll = `${parent}/${q.from[0].collectionId}`;
        const n = children(coll).filter((p) => q.where.compositeFilter.filters.every(({ fieldFilter: f }) => {
          const have = store[p][f.field.fieldPath];
          if (f.op === 'EQUAL') return have?.stringValue === f.value.stringValue;
          if (f.op === 'GREATER_THAN') return have?.timestampValue > f.value.timestampValue;
          return false;
        })).length;
        return Response.json([{ result: { aggregateFields: { n: { integerValue: String(n) } } } }]);
      }
      const p = rel(path);
      if (store[p]) return Response.json({ name: `${root}${p}`, fields: store[p] });
      const kids = children(p);
      if (kids.length) return Response.json({ documents: kids.map((k) => ({ name: `${root}${k}`, fields: store[k] })) });
      return p.split('/').length % 2 === 0 ? Response.json({ error: { message: 'not found' } }, { status: 404 }) : Response.json({});
    }
    if (u.host === 'graph.facebook.com') {
      if (u.pathname.endsWith('/oauth/access_token')) return Response.json({ access_token: u.searchParams.get('grant_type') ? 'LONG' : 'SHORT' });
      if (u.pathname.endsWith('/me/accounts')) return Response.json({ data: metaPages });
    }
    throw new Error(`unexpected fetch ${url}`);
  }

  return {
    project, serviceAccount, idToken, store, doc, put, fetches, fetchImpl,
    setGoogleCode: (code, tokens) => { googleTokens[code] = tokens; },
    setMetaPages: (pages) => { metaPages = pages; },
  };
}
