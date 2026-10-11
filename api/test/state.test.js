import test from 'node:test';
import assert from 'node:assert';
import { makeState, readState } from '../src/state.js';

const SECRET = 'test-secret';

test('a state round-trips', async () => {
  const data = await readState(await makeState({ uid: 'u1', p: 'youtube' }, SECRET), SECRET);
  assert.strictEqual(data.uid, 'u1');
  assert.strictEqual(data.p, 'youtube');
});

test('a forged state is rejected', async () => {
  const [, mac] = (await makeState({ uid: 'u1', p: 'youtube' }, SECRET)).split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 'attacker', p: 'youtube', exp: Date.now() + 1e6 })).toString('base64url');
  assert.strictEqual(await readState(`${forged}.${mac}`, SECRET), null);
  assert.strictEqual(await readState('garbage', SECRET), null);
  assert.strictEqual(await readState(undefined, SECRET), null);
});

test('a state expires after 15 minutes', async () => {
  const state = await makeState({ uid: 'u1' }, SECRET, Date.now());
  assert.ok(await readState(state, SECRET, Date.now() + 14 * 60e3));
  assert.strictEqual(await readState(state, SECRET, Date.now() + 16 * 60e3), null);
});

test('a state signed with another secret is rejected', async () => {
  assert.strictEqual(await readState(await makeState({ uid: 'u1' }, SECRET), 'other'), null);
});
