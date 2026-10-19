import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  connectFirestoreEmulator,
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

/**
 * Local full-stack mode — Phase 13 / 07 (layout checks) and 08 (authenticated
 * Lighthouse). Only when the BUILD sets VITE_USE_EMULATORS=true AND the page
 * is served from this machine: a bundle built that way by mistake and
 * deployed would otherwise send real users' sign-ins to localhost. A normal
 * build never sets the variable, so this block is removed as dead code.
 */
if (
  import.meta.env.VITE_USE_EMULATORS === 'true'
  && typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname)
) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
}

// Initialize analytics conditionally
let analytics = null;
if (import.meta.env.VITE_ENABLE_ANALYTICS === 'true') {
  isSupported().then(supported => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Analytics is unsupported in this browser (or blocked). Non-fatal, and
    // deliberately silent — this fires on every privacy-extension user.
  });
}

export { analytics };
export default app;

// No startup logging. The previous three console.log calls here printed the
// Firebase project ID and auth domain into every visitor's console on every
// page load — Phase 01 D3.
