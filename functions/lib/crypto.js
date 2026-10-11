/**
 * Encryption for connected accounts' OAuth tokens at rest (AES-256-GCM).
 * The same format is written by functions/lib/crypto.js when an account is
 * connected and read here when the worker publishes. TOKEN_KEY is a
 * base64-encoded 32-byte key held only by the functions and the worker —
 * never by the browser, and never stored in Firestore.
 *
 * Format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>" of a JSON object.
 */
const crypto = require('crypto');

function key() {
  const k = Buffer.from(process.env.TOKEN_KEY || '', 'base64');
  if (k.length !== 32) throw new Error('TOKEN_KEY must be a base64-encoded 32-byte key');
  return k;
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(text) {
  const [version, iv, tag, data] = String(text || '').split(':');
  if (version !== 'v1') throw new Error('unknown token format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8'));
}

module.exports = { encrypt, decrypt };
