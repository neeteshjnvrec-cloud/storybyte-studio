/**
 * Looks up a connected account and its decrypted credentials.
 *
 *   users/{uid}/connections/{connId}  public metadata (the dashboard reads it)
 *   tokens/{uid}__{connId}            encrypted credentials (no client access)
 *
 * A credential the platform has revoked (password change, access removed,
 * an unverified Google app's 7-day expiry) marks the connection 'expired',
 * so the dashboard asks the user to reconnect.
 */
const { google } = require('googleapis');
const { db, FieldValue } = require('./firebase');
const { decrypt } = require('./crypto');

async function getConnection(uid, connId) {
  const [meta, secret] = await Promise.all([
    db.doc(`users/${uid}/connections/${connId}`).get(),
    db.doc(`tokens/${uid}__${connId}`).get(),
  ]);
  if (!meta.exists || !secret.exists) return null;
  return { id: connId, ...meta.data(), credentials: decrypt(secret.data().enc) };
}

async function markExpired(uid, connId, reason) {
  await db.doc(`users/${uid}/connections/${connId}`).set(
    { status: 'expired', statusReason: String(reason).slice(0, 300), statusAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/** An authenticated googleapis YouTube client for a YouTube connection. */
function youtubeClient(conn) {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: conn.credentials.refreshToken });
  return google.youtube({ version: 'v3', auth });
}

/** True for errors that mean "the user must reconnect", not "try again". */
function isRevoked(error) {
  return /invalid_grant|token has been expired or revoked|Error validating access token|session has been invalidated|OAuthException.*(190|463|467)/i
    .test(String(error?.message || error));
}

module.exports = { getConnection, markExpired, youtubeClient, isRevoked };
