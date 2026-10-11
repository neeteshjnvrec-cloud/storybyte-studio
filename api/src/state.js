/**
 * The OAuth `state` parameter: who started the connect flow and for which
 * platform, signed with STATE_SECRET so a callback can't be forged or
 * replayed onto another user's account. Valid for 15 minutes.
 */
import { b64url, b64urlJson } from './google-auth.js';

const TTL_MS = 15 * 60e3;
const enc = new TextEncoder();

async function hmac(secret, payload) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

export async function makeState(data, secret, now = Date.now()) {
  if (!secret) throw new Error('STATE_SECRET is not set');
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(8)));
  const payload = b64urlJson({ ...data, exp: now + TTL_MS, n: nonce });
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function readState(state, secret, now = Date.now()) {
  try {
    const [payload, mac] = String(state || '').split('.');
    if (!payload || !mac || !secret) return null;
    const expected = await hmac(secret, payload);
    let diff = expected.length ^ mac.length;
    for (let i = 0; i < Math.min(expected.length, mac.length); i++) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
    if (diff) return null;
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return data.exp > now ? data : null;
  } catch {
    return null;
  }
}
