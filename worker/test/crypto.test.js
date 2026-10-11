const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.env.TOKEN_KEY = crypto.randomBytes(32).toString('base64');
const { encrypt, decrypt } = require('../src/crypto');

test('round-trips and never stores the plaintext', () => {
  const enc = encrypt({ refreshToken: 'secret-refresh-token' });
  assert.ok(!enc.includes('secret-refresh-token'));
  assert.deepStrictEqual(decrypt(enc), { refreshToken: 'secret-refresh-token' });
});

test('tampering is detected', () => {
  const parts = encrypt({ a: 1 }).split(':');
  parts[3] = Buffer.from('{"a":2}').toString('base64');
  assert.throws(() => decrypt(parts.join(':')));
});

test('a wrong key fails loudly', () => {
  const enc = encrypt({ a: 1 });
  const saved = process.env.TOKEN_KEY;
  process.env.TOKEN_KEY = crypto.randomBytes(32).toString('base64');
  try {
    assert.throws(() => decrypt(enc));
  } finally {
    process.env.TOKEN_KEY = saved;
  }
});
