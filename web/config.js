// Your Firebase web app's config (Firebase console → Project settings →
// Your apps → Web app) and the API's address (the Cloudflare Worker). These
// are public identifiers, not secrets: what users can do is decided by
// firestore.rules and the API. The deploy workflow overwrites this file.
export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.appspot.com',
  appId: 'REPLACE_ME',
};

export const apiUrl = 'https://storybyte-studio-api.REPLACE_ME.workers.dev';
