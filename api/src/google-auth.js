/**
 * Google credentials without the Admin SDK (which needs Node): a service
 * account access token for Firestore, and verification of the Firebase ID
 * tokens the dashboard sends. Both use WebCrypto, available in Cloudflare
 * Workers and in Node 22 for the tests.
 */
const enc = new TextEncoder();

export const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64urlJson = (obj) => b64url(enc.encode(JSON.stringify(obj)));
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

function pemToDer(pem) {
  return Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
}

let cachedToken = null;

/** An OAuth access token for the service account (cached until near expiry). */
export async function serviceAccountToken(sa, scope = 'https://www.googleapis.com/auth/datastore') {
  if (cachedToken && cachedToken.key === sa.client_email && cachedToken.exp > Date.now() + 60e3) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({
    iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), RSA, false, ['sign']);
  const signature = await crypto.subtle.sign(RSA, key, enc.encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`service account sign-in failed: ${json.error_description || json.error || res.status}`);
  cachedToken = { key: sa.client_email, value: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return json.access_token;
}

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwks = null;

async function signingKey(kid) {
  if (!jwks || jwks.exp < Date.now() || !jwks.keys[kid]) {
    const res = await fetch(JWKS_URL);
    const json = await res.json();
    const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
    jwks = { exp: Date.now() + maxAge * 1000, keys: Object.fromEntries((json.keys || []).map((k) => [k.kid, k])) };
  }
  const jwk = jwks.keys[kid];
  return jwk ? crypto.subtle.importKey('jwk', jwk, RSA, false, ['verify']) : null;
}

/** The uid in a valid Firebase ID token for `projectId`, else null. */
export async function verifyIdToken(token, projectId) {
  try {
    const [h, p, s] = String(token || '').split('.');
    const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
    if (header.alg !== 'RS256') return null;
    const key = await signingKey(header.kid);
    if (!key || !(await crypto.subtle.verify(RSA, key, fromB64url(s), enc.encode(`${h}.${p}`)))) return null;
    const now = Date.now() / 1000;
    if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (!(claims.exp > now) || claims.iat > now + 300 || !claims.sub) return null;
    return claims.sub;
  } catch {
    return null;
  }
}
