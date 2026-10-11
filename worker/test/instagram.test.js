const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { publishToInstagram } = require('../src/publish/instagram');

test('uploads the Reel file straight to Meta, then publishes and comments', async () => {
  const video = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ig-')), 'v.mp4');
  fs.writeFileSync(video, Buffer.alloc(1234, 7));
  const calls = [];
  let polls = 0;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const params = opts.body instanceof URLSearchParams ? Object.fromEntries(opts.body) : Object.fromEntries(u.searchParams);
    calls.push(`${opts.method || 'GET'} ${u.host}${u.pathname.replace(/\/v[\d.]+/, '')}`);
    if (u.host === 'rupload.facebook.com') {
      assert.strictEqual(opts.headers.Authorization, 'OAuth PT');
      assert.strictEqual(opts.headers.file_size, '1234');
      assert.strictEqual(opts.headers.offset, '0');
      assert.strictEqual(opts.body.length, 1234);
      return Response.json({ success: true });
    }
    assert.strictEqual(params.access_token, 'PT');
    if (u.pathname.endsWith('/IG1/media')) {
      assert.strictEqual(params.upload_type, 'resumable');
      assert.strictEqual(params.media_type, 'REELS');
      assert.ok(!('video_url' in params));
      return Response.json({ id: 'C1', uri: 'https://rupload.facebook.com/ig-api-upload/C1' });
    }
    if (u.pathname.endsWith('/C1')) return Response.json({ status_code: (polls += 1) > 1 ? 'FINISHED' : 'IN_PROGRESS' });
    if (u.pathname.endsWith('/IG1/media_publish')) return Response.json({ id: 'M1' });
    if (u.pathname.endsWith('/M1')) return Response.json({ permalink: 'https://instagram.com/reel/M1' });
    if (u.pathname.endsWith('/M1/comments')) return Response.json({ id: 'K' });
    throw new Error(`unexpected ${url}`);
  };
  const conn = { externalId: 'IG1', credentials: { pageToken: 'PT' } };
  const origTimeout = global.setTimeout;
  global.setTimeout = (fn) => origTimeout(fn, 0);
  try {
    const result = await publishToInstagram(conn, { videoPath: video, caption: 'hi', comment: 'q?' });
    assert.deepStrictEqual(result, { posted: true, id: 'M1', url: 'https://instagram.com/reel/M1' });
  } finally {
    global.setTimeout = origTimeout;
  }
  assert.deepStrictEqual(calls, [
    'POST graph.facebook.com/IG1/media', 'POST rupload.facebook.com/ig-api-upload/C1',
    'GET graph.facebook.com/C1', 'GET graph.facebook.com/C1', 'POST graph.facebook.com/IG1/media_publish',
    'GET graph.facebook.com/M1', 'POST graph.facebook.com/M1/comments',
  ]);
});

test('a failed upload is reported, not published', async () => {
  const video = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ig-')), 'v.mp4');
  fs.writeFileSync(video, 'x');
  global.fetch = async (url) => (String(url).includes('rupload')
    ? Response.json({ debug_info: { message: 'Processing failed' } }, { status: 400 })
    : Response.json({ id: 'C1' }));
  await assert.rejects(publishToInstagram({ externalId: 'IG1', credentials: { pageToken: 'PT' } }, { videoPath: video }), /Instagram upload failed: Processing failed/);
});
