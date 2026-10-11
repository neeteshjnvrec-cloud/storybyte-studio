/**
 * Firebase Admin for the worker. FIREBASE_SERVICE_ACCOUNT holds the
 * project's service account key JSON (a GitHub secret); without it, Google
 * Application Default Credentials are used.
 */
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  admin.initializeApp(json ? { credential: admin.credential.cert(JSON.parse(json)) } : {});
}

const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

module.exports = { admin, db, FieldValue, Timestamp };
