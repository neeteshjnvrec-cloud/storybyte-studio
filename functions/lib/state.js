/**
 * The OAuth `state` parameter: who started the connect flow, for which
 * platform, signed with STATE_SECRET so a callback can't be forged or
 * replayed onto another user's account. Valid for 15 minutes.
 */
const crypto = require('crypto');

const TTL_MS = 15 * 60e3;

function sign(payload) {
  return crypto.createHmac('sha256', process.env.STATE_SECRET || '').update(payload).digest('base64url');
}

function makeState(data, now = Date.now()) {
  if (!process.env.STATE_SECRET) throw new Error('STATE_SECRET is not set');
  const payload = Buffer.from(JSON.stringify({ ...data, exp: now + TTL_MS, n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readState(state, now = Date.now()) {
  const [payload, mac] = String(state || '').split('.');
  if (!payload || !mac || !process.env.STATE_SECRET) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  return data.exp > now ? data : null;
}

module.exports = { makeState, readState };
