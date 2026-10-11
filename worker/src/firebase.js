/**
 * Firebase Admin for the worker. On Cloud Run it uses the job's own service
 * account (Application Default Credentials); for a local run,
 * FIREBASE_SERVICE_ACCOUNT can hold a service account key's JSON instead.
 */
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  admin.initializeApp({
    ...(json ? { credential: admin.credential.cert(JSON.parse(json)) } : {}),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const db = admin.firestore();
const bucket = () => admin.storage().bucket();
const { FieldValue, Timestamp } = admin.firestore;

module.exports = { admin, db, bucket, FieldValue, Timestamp };
