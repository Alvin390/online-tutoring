import { initializeApp, getApps } from 'firebase/app';

/**
 * The Firebase app alone — Phase 13 / 08 A2. Split from config.js so that
 * analytics (loaded on demand, possibly on a public page) can get the app
 * without also initialising Auth and Firestore.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = getApps()[0] ?? initializeApp(firebaseConfig);

export default app;
