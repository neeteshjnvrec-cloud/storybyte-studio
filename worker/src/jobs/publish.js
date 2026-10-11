/**
 * Publishes one finished video to each platform a profile targets, using
 * that user's own connected accounts. Platforms are independent: one
 * failing never stops the others, and a revoked login marks the connection
 * 'expired' so the dashboard asks the user to reconnect.
 */
const { getConnection, markExpired, isRevoked } = require('../tokens');
const { publishToYouTube } = require('../publish/youtube');
const { publishToFacebook } = require('../publish/facebook');
const { publishToInstagram } = require('../publish/instagram');
const { shareTemporarily } = require('../publish/storage');

async function publishAll({ uid, profile, jobId, videoPath, thumbnailPath, post, platforms }) {
  const results = {};
  for (const platform of platforms) {
    const connId = profile.targets?.[platform];
    if (!connId) continue;
    try {
      const conn = await getConnection(uid, connId);
      if (!conn) throw new Error('connection not found — reconnect it on the dashboard');
      if (conn.platform !== platform) throw new Error(`connection ${connId} is a ${conn.platform} account, not ${platform}`);
      if (platform === 'youtube') {
        results.youtube = await publishToYouTube(conn, { ...post, videoPath, thumbnailPath, madeForKids: profile.niche === 'kids' });
      } else if (platform === 'facebook') {
        results.facebook = await publishToFacebook(conn, { ...post, videoPath, thumbnailPath, description: post.caption });
      } else if (platform === 'instagram') {
        const shared = await shareTemporarily(videoPath, { uid, jobId });
        try {
          results.instagram = await publishToInstagram(conn, { videoUrl: shared.url, caption: post.caption, comment: post.comment });
        } finally {
          await shared.remove().catch(() => {});
        }
      }
      console.log(`  ✅ ${platform}: ${results[platform].url || results[platform].id}`);
    } catch (e) {
      results[platform] = { posted: false, error: String(e.message || e).slice(0, 500) };
      console.warn(`  ⚠️  ${platform}: ${e.message}`);
      if (isRevoked(e)) await markExpired(uid, connId, e.message).catch(() => {});
    }
  }
  return results;
}

module.exports = { publishAll };
