/**
 * Google sign-in for a YouTube channel. offline + consent always returns a
 * refresh token, which is what the worker publishes with. A Google account
 * with several channels (Brand Accounts) picks one on Google's consent
 * screen; connect again to add another.
 */
const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  // Posting the first comment on a new video.
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

const client = ({ clientId, clientSecret, redirectUri }) => new google.auth.OAuth2(clientId, clientSecret, redirectUri);

function authUrl(opts, state) {
  return client(opts).generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state, include_granted_scopes: true });
}

/** Exchanges the code; returns { refreshToken, channel: {id, title, thumbnail} }. */
async function channelFor(opts, code) {
  const auth = client(opts);
  const { tokens } = await auth.getToken(code);
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token — remove the app at myaccount.google.com/permissions and connect again');
  auth.setCredentials(tokens);
  const granted = String(tokens.scope || '');
  if (!granted.includes('youtube.upload')) throw new Error('Permission to upload videos was not granted — connect again and tick every box');
  const { data } = await google.youtube({ version: 'v3', auth }).channels.list({ part: ['snippet'], mine: true });
  const ch = data.items?.[0];
  if (!ch) throw new Error('This Google account has no YouTube channel yet — create one at youtube.com first');
  return {
    refreshToken: tokens.refresh_token,
    channel: { id: ch.id, title: ch.snippet?.title || ch.id, thumbnail: ch.snippet?.thumbnails?.default?.url || '' },
  };
}

module.exports = { authUrl, channelFor, SCOPES };
