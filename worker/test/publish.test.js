const test = require('node:test');
const assert = require('node:assert');
const { stub } = require('./helpers');

const calls = [];
const expired = [];
const connections = {
  yt1: { id: 'yt1', platform: 'youtube', credentials: {} },
  fb1: { id: 'fb1', platform: 'facebook', credentials: {} },
  ig1: { id: 'ig1', platform: 'instagram', credentials: {} },
};
let failYouTube = null;

stub('tokens.js', {
  getConnection: async (uid, id) => connections[id] || null,
  markExpired: async (uid, id, reason) => expired.push([id, reason]),
  isRevoked: (e) => /invalid_grant/.test(e.message),
});
stub('publish/youtube.js', {
  publishToYouTube: async (conn, post) => {
    calls.push(['youtube', post.madeForKids, post.isShort]);
    if (failYouTube) throw failYouTube;
    return { posted: true, id: 'Y', url: 'https://youtu.be/Y' };
  },
});
stub('publish/facebook.js', { publishToFacebook: async (conn, post) => { calls.push(['facebook', post.description]); return { posted: true, id: 'F', url: 'f' }; } });
stub('publish/instagram.js', { publishToInstagram: async (conn, post) => { calls.push(['instagram', post.videoUrl]); return { posted: true, id: 'I', url: 'i' }; } });
stub('publish/storage.js', {
  shareTemporarily: async () => ({ url: 'https://signed', remove: async () => calls.push(['removed']) }),
});

const { publishAll } = require('../src/jobs/publish');
const post = { title: 't', description: 'd', caption: 'caption', isShort: true, comment: 'c' };

test('publishes to every targeted account, each with its own post', async () => {
  calls.length = 0;
  const profile = { niche: 'kids', targets: { youtube: 'yt1', facebook: 'fb1', instagram: 'ig1' } };
  const results = await publishAll({ uid: 'u', profile, jobId: 'j', videoPath: '/v.mp4', post, platforms: ['youtube', 'facebook', 'instagram'] });
  assert.deepStrictEqual(Object.keys(results), ['youtube', 'facebook', 'instagram']);
  assert.deepStrictEqual(calls, [['youtube', true, true], ['facebook', 'caption'], ['instagram', 'https://signed'], ['removed']]);
});

test('skips platforms without a target', async () => {
  calls.length = 0;
  const results = await publishAll({ uid: 'u', profile: { targets: { facebook: 'fb1' } }, jobId: 'j', videoPath: '/v', post, platforms: ['youtube', 'facebook', 'instagram'] });
  assert.deepStrictEqual(Object.keys(results), ['facebook']);
});

test('one platform failing does not stop the others; a revoked login marks the account expired', async () => {
  calls.length = 0;
  failYouTube = new Error('invalid_grant: Token has been expired or revoked');
  try {
    const profile = { targets: { youtube: 'yt1', facebook: 'fb1' } };
    const results = await publishAll({ uid: 'u', profile, jobId: 'j', videoPath: '/v', post, platforms: ['youtube', 'facebook'] });
    assert.strictEqual(results.youtube.posted, false);
    assert.strictEqual(results.facebook.posted, true);
    assert.strictEqual(expired[0][0], 'yt1');
  } finally {
    failYouTube = null;
  }
});

test('refuses a connection of the wrong platform (e.g. a Page id under youtube)', async () => {
  const results = await publishAll({ uid: 'u', profile: { targets: { youtube: 'fb1' } }, jobId: 'j', videoPath: '/v', post, platforms: ['youtube'] });
  assert.match(results.youtube.error, /is a facebook account/);
});
