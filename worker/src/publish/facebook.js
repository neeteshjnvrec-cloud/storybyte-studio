/**
 * Uploads a video to a user's connected Facebook Page with Graph's resumable
 * upload (start / chunked transfer / finish) — a single-request upload of a
 * long 1080p video is rejected with HTTP 413. Optionally posts a first
 * comment as the Page.
 */
const fs = require('fs');
const path = require('path');

const VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const VIDEO_GRAPH = `https://graph-video.facebook.com/${VERSION}`;
const GRAPH = `https://graph.facebook.com/${VERSION}`;

async function phase(pageId, form) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${VIDEO_GRAPH}/${pageId}/videos`, { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (res.ok && !json.error) return json;
    if (attempt < 3 && (res.status >= 500 || json.error?.is_transient)) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(json.error?.message || `HTTP ${res.status}`);
  }
}

async function publishToFacebook(conn, { videoPath, title, description, thumbnailPath, comment }) {
  const pageId = conn.externalId;
  const token = conn.credentials.pageToken;
  const fields = (entries) => {
    const form = new FormData();
    form.append('access_token', token);
    for (const [k, v] of Object.entries(entries)) form.append(k, v);
    return form;
  };

  const session = await phase(pageId, fields({ upload_phase: 'start', file_size: String(fs.statSync(videoPath).size) }));
  let start = Number(session.start_offset);
  let end = Number(session.end_offset);
  const fd = fs.openSync(videoPath, 'r');
  try {
    while (start < end) {
      const chunk = Buffer.alloc(end - start);
      fs.readSync(fd, chunk, 0, chunk.length, start);
      const form = fields({ upload_phase: 'transfer', upload_session_id: session.upload_session_id, start_offset: String(start) });
      form.append('video_file_chunk', new Blob([chunk]), 'chunk');
      const next = await phase(pageId, form);
      start = Number(next.start_offset);
      end = Number(next.end_offset);
    }
  } finally {
    fs.closeSync(fd);
  }

  const finish = async (withThumb) => {
    const form = fields({
      upload_phase: 'finish', upload_session_id: session.upload_session_id,
      title: String(title || '').slice(0, 255), description: String(description || ''), published: 'true',
    });
    if (withThumb) form.append('thumb', await fs.openAsBlob(thumbnailPath, { type: 'image/jpeg' }), path.basename(thumbnailPath));
    return phase(pageId, form);
  };
  const hasThumb = Boolean(thumbnailPath && fs.existsSync(thumbnailPath));
  try {
    await finish(hasThumb);
  } catch (e) {
    if (!hasThumb) throw e;
    await finish(false); // the upload is done; don't lose the post over its cover
  }

  const result = { posted: true, id: session.video_id, url: `https://www.facebook.com/${pageId}/videos/${session.video_id}` };
  if (comment) {
    try {
      const res = await fetch(`${GRAPH}/${session.video_id}/comments`, {
        method: 'POST',
        body: new URLSearchParams({ message: comment, access_token: token }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
    } catch (e) {
      result.commentError = e.message;
    }
  }
  return result;
}

module.exports = { publishToFacebook };
