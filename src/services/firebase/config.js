import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);

// Initialize Firestore with persistent local cache for offline support
// This is the modern approach (Firestore v10+) that replaces enableIndexedDbPersistence()
// It provides:
// - Offline data caching (app works without internet)
// - Automatic sync when connection returns
// - Multi-tab support (works across multiple browser tabs)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

console.log('✅ Firestore initialized with offline persistence enabled');

// Initialize analytics conditionally
let analytics = null;
if (import.meta.env.VITE_ENABLE_ANALYTICS === 'true') {
  isSupported().then(supported => {
    if (supported) {
      analytics = getAnalytics(app);
      console.log('✅ Firebase Analytics initialized');
    }
  }).catch(err => {
    console.warn('Firebase Analytics not supported:', err);
  });
}

export { analytics };
export default app;

console.log('✅ Firebase initialized successfully', {
  projectId: app.options.projectId,
  authDomain: app.options.authDomain
});
