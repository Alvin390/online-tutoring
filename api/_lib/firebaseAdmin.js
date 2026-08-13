import { getFirestoreRest, FieldValue, Timestamp } from './firestoreRest.js';
import { getAuthRest } from './authRest.js';
import { getStorageRest } from './storageRest.js';
import { firestoreEmulatorHost, getProjectId, loadServiceAccount } from './googleAuth.js';

/**
 * Firebase server-side clients — Phase 01 D4, re-implemented in Phase 12 D4.
 *
 * This used to wrap `firebase-admin`. It no longer does, because that package
 * cannot run on Cloudflare Workers: it needs gRPC, http2, net, tls, dns and fs,
 * and `nodejs_compat` provides none of them. The three clients below are backed
 * by ./firestoreRest.js, ./authRest.js and ./storageRest.js, which speak the
 * same Google REST APIs using only `fetch` and `node:crypto`.
 *
 * THE EXPORTED SURFACE IS UNCHANGED. Every one of the 42 modules that imports
 * from here — and all three scripts in scripts/ — is untouched by the
 * migration, which is the entire point of doing it this way: a billing system
 * with 600-odd tests does not want a 42-file rewrite on top of a hosting move.
 *
 * The shims also run in plain Node, so `npm run seed:superadmin`,
 * `npm run health` and the emulator test suites all work exactly as before.
 *
 * Initialisation stays LAZY. Importing this module must not throw when
 * credentials are absent, or unit tests of sibling modules could not import
 * anything in this directory.
 *
 * NOTE, unchanged from Phase 01 and still the most important line in this file:
 * these clients BYPASS firestore.rules entirely. Every handler that touches
 * them is responsible for its own authorization — see requireAuth /
 * requireRole in ./auth.js.
 */

let cachedApp = null;

/**
 * Kept for the two callers that ask for the "app" before reaching a service
 * (`getStorage(getAdminApp())`). There is no SDK app object any more, so this
 * is the small descriptor the shims actually need, and resolving it eagerly
 * here means a missing credential still fails loudly and early rather than at
 * the first write.
 */
export function getAdminApp() {
  if (cachedApp) return cachedApp;

  if (firestoreEmulatorHost()) {
    cachedApp = { projectId: getProjectId(), emulated: true };
    return cachedApp;
  }

  const serviceAccount = loadServiceAccount();
  cachedApp = {
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    emulated: false,
  };
  return cachedApp;
}

let cachedDb = null;
export function getDb() {
  if (!cachedDb) {
    cachedDb = getFirestoreRest();
    cachedDb.settings({ ignoreUndefinedProperties: true });
  }
  return cachedDb;
}

let cachedAuth = null;
export function getAdminAuth() {
  if (!cachedAuth) cachedAuth = getAuthRest();
  return cachedAuth;
}

/**
 * Mirrors `getStorage(app)` from firebase-admin/storage, including accepting
 * and ignoring the app argument, so api/whatsapp/upload.js reads unchanged.
 */
export function getStorage() {
  return getStorageRest();
}

export { FieldValue, Timestamp };
