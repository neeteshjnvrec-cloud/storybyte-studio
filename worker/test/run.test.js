const test = require('node:test');
const assert = require('node:assert');
const { stub, fakeDb, Timestamp, FieldValue } = require('./helpers');

const db = fakeDb();
stub('firebase.js', { db, Timestamp, FieldValue });
let runs = 0;
let fail = false;
stub('jobs/short.js', {
  runShort: async () => {
    runs += 1;
    if (fail) throw new Error('render exploded');
    return { kind: 'short', results: { youtube: { posted: true } } };
  },
});
stub('jobs/long.js', { runLong: async () => ({ kind: 'long', results: {} }) });
const { enqueueDue, processJob } = require('../src/run');

const profile = (extra = {}) => ({ active: true, timezone: 'UTC', shorts: { enabled: true, times: ['10:00'] }, ...extra });

test('a due slot is queued exactly once, however often the scheduler runs', async () => {
  db.store['users/u1/profiles/p1'] = profile();
  const now = Date.parse('2026-10-11T10:30:00Z');
  db.store['system/scheduler'] = { lastRunAt: Timestamp.fromMillis(now - 3600e3) };
  await enqueueDue(now);
  db.store['system/scheduler'] = { lastRunAt: Timestamp.fromMillis(now - 3600e3) }; // a retried run
  await enqueueDue(now);
  const jobs = Object.keys(db.store).filter((p) => p.startsWith('users/u1/jobs/'));
  assert.deepStrictEqual(jobs, ['users/u1/jobs/p1_short_2026-10-11T10-00-00-000Z']);
  assert.strictEqual(db.store[jobs[0]].status, 'queued');
});

test('only the first 3 active profiles of a user are scheduled', async () => {
  for (let i = 0; i < 5; i++) db.store[`users/u2/profiles/q${i}`] = profile();
  const now = Date.parse('2026-10-12T10:30:00Z');
  db.store['system/scheduler'] = { lastRunAt: Timestamp.fromMillis(now - 3600e3) };
  await enqueueDue(now);
  const jobs = Object.keys(db.store).filter((p) => p.startsWith('users/u2/jobs/'));
  assert.strictEqual(jobs.length, 3);
});

test('a finished job is done; a crashed job is retried once, then failed', async () => {
  db.store['users/u1/jobs/ok'] = { profileId: 'p1', kind: 'short', status: 'queued', attempts: 0 };
  await processJob(db.doc('users/u1/jobs/ok'));
  assert.strictEqual(db.store['users/u1/jobs/ok'].status, 'done');

  fail = true;
  runs = 0;
  db.store['users/u1/jobs/bad'] = { profileId: 'p1', kind: 'short', status: 'queued', attempts: 0 };
  await processJob(db.doc('users/u1/jobs/bad'));
  assert.strictEqual(db.store['users/u1/jobs/bad'].status, 'queued');
  await processJob(db.doc('users/u1/jobs/bad'));
  await processJob(db.doc('users/u1/jobs/bad'));
  assert.strictEqual(runs, 2);
  assert.strictEqual(db.store['users/u1/jobs/bad'].status, 'failed');
  assert.match(db.store['users/u1/jobs/bad'].error, /render exploded/);
  fail = false;
});

test('a job already running is not picked up twice', async () => {
  runs = 0;
  db.store['users/u1/jobs/busy'] = { profileId: 'p1', kind: 'short', status: 'running', attempts: 1,
    leaseUntil: Timestamp.fromMillis(Date.now() + 3600e3) };
  await processJob(db.doc('users/u1/jobs/busy'));
  assert.strictEqual(runs, 0);
});

test('a job for a deleted profile is skipped', async () => {
  db.store['users/u1/jobs/orphan'] = { profileId: 'gone', kind: 'short', status: 'queued', attempts: 0 };
  await processJob(db.doc('users/u1/jobs/orphan'));
  assert.strictEqual(db.store['users/u1/jobs/orphan'].status, 'skipped');
});
