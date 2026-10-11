/**
 * Google sign-in for a YouTube channel. offline + consent always returns a
 * refresh token, which the video worker publishes with. A Google account
 * with several channels (Brand Accounts) picks one on Google's consent
 * screen; connect again to add another.
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  // Posting the first comment on a new video.
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

export function authUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Exchanges the code; returns { refreshToken, channel: { id, title, thumbnail } }. */
export async function channelFor({ clientId, clientSecret, redirectUri, code }) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  const tokens = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed: ${tokens.error_description || tokens.error || res.status}`);
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token — remove the app at myaccount.google.com/permissions and connect again');
  if (!String(tokens.scope || '').includes('youtube.upload')) throw new Error('Permission to upload videos was not granted — connect again and tick every box');
  const ch = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }).then((r) => r.json());
  const item = ch.items?.[0];
  if (!item) throw new Error('This Google account has no YouTube channel yet — create one at youtube.com first');
  return {
    refreshToken: tokens.refresh_token,
    channel: { id: item.id, title: item.snippet?.title || item.id, thumbnail: item.snippet?.thumbnails?.default?.url || '' },
  };
}
