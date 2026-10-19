import app from './app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  clearIndexedDbPersistence,
} from 'firebase/firestore';

// The app itself is created in ./app.js (Phase 13 / 08 A2).

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
    tabManager: persistentMultipleTabManager(),
    // Phase 13 / 08 B5: an explicit ceiling (the SDK default is also 40 MB,
    // but stating it keeps a shared school computer's footprint deliberate).
    cacheSizeBytes: 40 * 1024 * 1024,
  })
});

/**
 * Deletes this browser's offline copy of the data — Phase 13 / 08 B5.
 *
 * The persistent cache holds the class roster (names, parents' phone numbers,
 * payment state). On a shared school or cyber-café computer that must not
 * outlive the teacher's session. Terminating the instance is required before
 * the IndexedDB data can be cleared, and a terminated instance cannot be
 * reused — so the caller reloads the page afterwards.
 */
export async function wipeLocalData() {
  await terminate(db);
  await clearIndexedDbPersistence(db);
}

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

// Analytics moved to ./analytics.js and loads only on demand (Phase 13 / 08 A2).
export default app;

// No startup logging. The previous three console.log calls here printed the
// Firebase project ID and auth domain into every visitor's console on every
// page load — Phase 01 D3.
