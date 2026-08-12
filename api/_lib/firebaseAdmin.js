import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

/**
 * Admin SDK singleton — Phase 01 D4.
 *
 * Initialised once at module scope and memoised, so a warm Vercel invocation
 * reuses the connection instead of paying the handshake again. Cold-start
 * mitigation, and the reason every handler imports from here rather than
 * calling initializeApp itself.
 *
 * Initialisation is lazy rather than eager: importing this module must not
 * throw when credentials are absent, or unit tests of sibling modules would be
 * unable to import anything in this directory.
 *
 * The Admin SDK BYPASSES firestore.rules entirely. Every handler that touches
 * it is therefore responsible for its own authorization — see requireAuth /
 * requireRole in ./auth.js.
 */

let cachedApp = null;

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not set. Add the service account JSON ' +
      '(raw or base64-encoded) as an encrypted environment variable.'
    );
  }

  const trimmed = raw.trim();
  const json = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');

  const parsed = JSON.parse(json);

  // Env vars flatten real newlines in the PEM body; restore them.
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  return parsed;
}

export function getAdminApp() {
  if (cachedApp) return cachedApp;

  const existing = getApps();
  if (existing.length > 0) {
    cachedApp = existing[0];
    return cachedApp;
  }

  /**
   * Emulator path — Phase 11 D1.
   *
   * When `FIRESTORE_EMULATOR_HOST` is set, the Admin SDK talks to a local
   * emulator and no real credential is involved, so handler integration tests
   * can run without a service account.
   *
   * This CANNOT weaken production: the variable is set only by
   * `firebase emulators:exec`, and if it were somehow present in a deployed
   * environment the SDK would be pointed at a non-existent local host and fail
   * immediately and loudly — never silently against real data.
   */
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    // Without this the SDK probes the GCE metadata server at 169.254.169.254
    // looking for Application Default Credentials, and waits out a network
    // timeout (~15s off-GCP) before falling through. It works, but it is slow
    // enough to blow a test hook timeout and it happens on every cold start.
    // The emulator needs no credentials at all, so the probe is pure waste.
    process.env.METADATA_SERVER_DETECTION ??= 'none';
    process.env.GCE_METADATA_HOST ??= '0.0.0.0';

    cachedApp = initializeApp({
      projectId: process.env.GCLOUD_PROJECT ?? 'demo-online-tutoring',
    });
    return cachedApp;
  }

  const serviceAccount = loadCredential();
  cachedApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });

  return cachedApp;
}

let cachedDb = null;
export function getDb() {
  if (!cachedDb) {
    cachedDb = getFirestore(getAdminApp());
    cachedDb.settings({ ignoreUndefinedProperties: true });
  }
  return cachedDb;
}

let cachedAuth = null;
export function getAdminAuth() {
  if (!cachedAuth) cachedAuth = getAuth(getAdminApp());
  return cachedAuth;
}

export { FieldValue, Timestamp };
