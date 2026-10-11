const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stub, fakeDb, FieldValue } = require('./helpers');

process.env.EPISODE_ENGINE = path.join(__dirname, 'fake-engine.js');
const engineCalls = [];

const db = fakeDb();
stub('firebase.js', { db, FieldValue });
const published = [];
stub('jobs/publish.js', {
  publishAll: async (args) => {
    published.push(args);
    return { youtube: { posted: true }, facebook: { posted: true } };
  },
});
const { runLong } = require('../src/jobs/long');

const profile = { id: 'p1', name: 'Krishna Leela', niche: 'devotional', language: 'hi', style: 'cartoon2d', voice: 'male',
  footer: 'Subscribe!', long: { enabled: true, days: [0], time: '18:00' }, targets: { youtube: 'yt1', facebook: 'fb1', instagram: 'ig1' } };

test('episodes continue the series: numbering, bible round-trip, style and voice', async () => {
  for (const n of [1, 2]) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'long-test-'));
    const result = await runLong({ uid: 'u1', profile, jobId: `j${n}`, workDir });
    engineCalls.push(JSON.parse(fs.readFileSync(path.join(workDir, 'engine-env.json'), 'utf8')));
    fs.rmSync(workDir, { recursive: true, force: true });
    assert.strictEqual(result.episode, n);
    assert.strictEqual(result.title, `Ep ${n}`);
  }
  assert.deepStrictEqual(db.store['users/u1/series/p1'].bible.episodes, ['1', '2']);
  assert.strictEqual(engineCalls[0].EPISODE_STYLE, 'cartoon2d');
  assert.strictEqual(engineCalls[0].EPISODE_LANGUAGE, 'hi');
  assert.strictEqual(engineCalls[0].EPISODE_PUBLISH, 'false');
  assert.match(engineCalls[0].EPISODE_VOICE, /^hi-IN-/);
});

test('episodes go to YouTube and Facebook only, with the footer', () => {
  const last = published[published.length - 1];
  assert.deepStrictEqual(last.platforms, ['youtube', 'facebook']);
  assert.strictEqual(last.post.isShort, false);
  assert.strictEqual(last.post.description, 'desc\n\nSubscribe!');
  assert.ok(last.thumbnailPath.endsWith('thumbnail.jpg'));
});
