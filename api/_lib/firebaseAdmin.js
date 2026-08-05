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
