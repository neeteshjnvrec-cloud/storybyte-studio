/**
 * Publishes a Reel to a user's connected Instagram professional account.
 *
 * The video is uploaded straight to Meta (a "resumable" upload to
 * rupload.facebook.com, available to apps using Facebook Login for
 * Business), so it never has to sit at a public URL — nothing is hosted or
 * stored on our side.
 */
const fs = require('fs');

const VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;

async function call(method, pathname, params, token) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === 'GET'
    ? await fetch(`${GRAPH}${pathname}?${body}`)
    : await fetch(`${GRAPH}${pathname}`, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message || `HTTP ${res.status}`);
  return json;
}

async function upload(containerId, videoPath, token) {
  const size = fs.statSync(videoPath).size;
  const res = await fetch(`https://rupload.facebook.com/ig-api-upload/${VERSION}/${containerId}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(size), 'Content-Type': 'application/octet-stream' },
    body: fs.readFileSync(videoPath),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false || json.error) {
    throw new Error(`Instagram upload failed: ${json.error?.message || json.debug_info?.message || `HTTP ${res.status}`}`);
  }
}

async function publishToInstagram(conn, { videoPath, caption, comment, timeoutMs = 10 * 60 * 1000 }) {
  const igId = conn.externalId;
  const token = conn.credentials.pageToken;
  const container = await call('POST', `/${igId}/media`, {
    media_type: 'REELS', upload_type: 'resumable', caption: String(caption || '').slice(0, 2200), share_to_feed: 'true',
  }, token);
  await upload(container.id, videoPath, token);

  const started = Date.now();
  for (;;) {
    const { status_code: status } = await call('GET', `/${container.id}`, { fields: 'status_code' }, token);
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`Instagram could not process the video (${status})`);
    if (Date.now() - started > timeoutMs) throw new Error('Instagram processing timed out');
    await new Promise((r) => setTimeout(r, 5000));
  }
  const media = await call('POST', `/${igId}/media_publish`, { creation_id: container.id }, token);
  const result = { posted: true, id: media.id };
  try {
    const { permalink } = await call('GET', `/${media.id}`, { fields: 'permalink' }, token);
    result.url = permalink;
  } catch { /* the post is live either way */ }
  if (comment) {
    try {
      await call('POST', `/${media.id}/comments`, { message: comment }, token);
    } catch (e) {
      result.commentError = e.message;
    }
  }
  return result;
}

module.exports = { publishToInstagram };
