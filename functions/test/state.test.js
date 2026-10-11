const test = require('node:test');
const assert = require('node:assert');

process.env.STATE_SECRET = 'test-secret';
const { makeState, readState } = require('../lib/state');

test('a state round-trips', () => {
  const data = readState(makeState({ uid: 'u1', p: 'youtube' }));
  assert.strictEqual(data.uid, 'u1');
  assert.strictEqual(data.p, 'youtube');
});

test('a forged state is rejected', () => {
  const [, mac] = makeState({ uid: 'u1', p: 'youtube' }).split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 'attacker', p: 'youtube', exp: Date.now() + 1e6 })).toString('base64url');
  assert.strictEqual(readState(`${forged}.${mac}`), null);
  assert.strictEqual(readState('garbage'), null);
  assert.strictEqual(readState(undefined), null);
});

test('a state expires after 15 minutes', () => {
  const state = makeState({ uid: 'u1' }, Date.now());
  assert.ok(readState(state, Date.now() + 14 * 60e3));
  assert.strictEqual(readState(state, Date.now() + 16 * 60e3), null);
});

test('a state signed with another secret is rejected', () => {
  const state = makeState({ uid: 'u1' });
  process.env.STATE_SECRET = 'other';
  try {
    assert.strictEqual(readState(state), null);
  } finally {
    process.env.STATE_SECRET = 'test-secret';
  }
});
