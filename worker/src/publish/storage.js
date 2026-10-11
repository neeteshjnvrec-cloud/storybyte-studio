/**
 * Temporary public URLs for Instagram, which downloads Reels from a URL
 * rather than accepting an upload. Files go to tmp/<uid>/<job>/ in the
 * project's Cloud Storage bucket with an ASCII-only name, are shared through
 * a 2-hour signed URL, and are deleted once the post is published.
 */
const { bucket } = require('../firebase');

async function shareTemporarily(localPath, { uid, jobId, name = 'video.mp4' }) {
  const dest = `tmp/${uid}/${String(jobId).replace(/[^A-Za-z0-9._-]/g, '-')}/${name}`;
  const b = bucket();
  await b.upload(localPath, { destination: dest, contentType: 'video/mp4', resumable: true });
  const [url] = await b.file(dest).getSignedUrl({ action: 'read', expires: Date.now() + 2 * 3600 * 1000, version: 'v4' });
  return { url, remove: () => b.file(dest).delete({ ignoreNotFound: true }) };
}

module.exports = { shareTemporarily };
