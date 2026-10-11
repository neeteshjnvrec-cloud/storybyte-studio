/**
 * Uploads a video to a user's connected YouTube channel, then optionally
 * sets its thumbnail and posts a first comment. Short videos go up as
 * Shorts (vertical, 3 minutes or less, "#shorts" in the title).
 */
const fs = require('fs');
const { youtubeClient } = require('../tokens');

// YouTube rejects < and > anywhere in a title or description, and an
// upload whose tags total more than 500 characters.
const safe = (s) => String(s || '').replace(/[<>]/g, '');
function capTags(tags, limit = 450) {
  const out = [];
  let used = 0;
  for (const tag of [...new Set(tags.map((t) => safe(t).replace(/,/g, '').trim()).filter(Boolean))]) {
    const cost = tag.length + (tag.includes(' ') ? 2 : 0) + 1;
    if (used + cost > limit) continue;
    out.push(tag);
    used += cost;
  }
  return out;
}

async function publishToYouTube(conn, { videoPath, title, description, tags = [], language, isShort, thumbnailPath, comment, madeForKids = false }) {
  const youtube = youtubeClient(conn);
  const fullTitle = isShort ? `${safe(title).slice(0, 91)} #shorts` : safe(title).slice(0, 100);
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: fullTitle,
        description: safe(description).slice(0, 5000),
        tags: capTags(tags),
        categoryId: '24',
        ...(language ? { defaultLanguage: language, defaultAudioLanguage: language } : {}),
      },
      // Every video here is AI-made (story, voice and pictures), which YouTube
      // asks creators to disclose; children's stories are "made for kids"
      // under YouTube's terms (COPPA), which also turns comments off.
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: !!madeForKids, containsSyntheticMedia: true },
    },
    media: { body: fs.createReadStream(videoPath) },
  });
  const videoId = res.data.id;
  const result = { posted: true, id: videoId, url: isShort ? `https://youtube.com/shorts/${videoId}` : `https://youtu.be/${videoId}` };

  // Optional extras — a failure here never un-publishes the video.
  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    try {
      await youtube.thumbnails.set({ videoId, media: { mimeType: 'image/jpeg', body: fs.createReadStream(thumbnailPath) } });
    } catch (e) {
      result.thumbnailError = e.message; // custom thumbnails need a phone-verified channel
    }
  }
  if (comment && !madeForKids) {
    try {
      await youtube.commentThreads.insert({
        part: ['snippet'],
        requestBody: { snippet: { videoId, topLevelComment: { snippet: { textOriginal: comment } } } },
      });
    } catch (e) {
      result.commentError = e.message;
    }
  }
  return result;
}

module.exports = { publishToYouTube, capTags };
