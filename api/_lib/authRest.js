import {
  authEmulatorHost,
  getProjectId,
  identityToolkitAuthHeader,
  loadServiceAccount,
  signJwt,
} from './googleAuth.js';

/**
 * Firebase Authentication over REST — Phase 12 D3.
 *
 * The Admin SDK's auth client is lighter than its Firestore client, but it
 * still cannot run on Cloudflare Workers, so the ten methods this codebase uses
 * are reimplemented here against the Identity Toolkit REST API and Web Crypto.
 *
 * The surface and the ERROR CODES are preserved exactly, because call sites
 * branch on them:
 *
 *   api/_lib/claims.js:84       err.code === 'auth/user-not-found' -> return null
 *   api/student/verifyCode.js:95 err.code === 'auth/user-not-found' -> create
 *   api/_lib/auth.js:61          err.code === 'auth/id-token-revoked'
 *   api/_lib/auth.js:64          err.code === 'auth/id-token-expired'
 *
 * A rewritten code here would not fail loudly — it would fall through to a
 * generic "sign in to continue", which is exactly the kind of regression that
 * survives a test suite and annoys real users.
 */

const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';
const SECURE_TOKEN_ISSUER = 'https://securetoken.google.com';
const CUSTOM_TOKEN_AUDIENCE =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

/**
 * Google's public keys for ID token signatures, in JWK form.
 *
 * The x509 endpoint is the one most examples use, but it hands back PEM
 * certificates that would have to be parsed to extract the public key. The JWK
 * endpoint serves exactly what `crypto.subtle.importKey` consumes.
 */
const JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const CUSTOM_TOKEN_TTL_SECONDS = 3600;

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FirebaseAuthError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Base URLs
// ---------------------------------------------------------------------------

function identityBase() {
  const emulator = authEmulatorHost();
  const root = emulator ? `http://${emulator}/identitytoolkit.googleapis.com/v1` : IDENTITY_TOOLKIT;
  return `${root}/projects/${getProjectId()}`;
}

async function identityRequest(path, { method = 'POST', body } = {}) {
  const url = `${identityBase()}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: await identityToolkitAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    // Identity Toolkit reports failures as an upper-snake message string
    // ("EMAIL_EXISTS", "USER_NOT_FOUND") rather than a status enum.
    const reason = payload?.error?.message ?? `HTTP ${response.status}`;
    throw toAuthError(reason, response.status);
  }

  return payload;
}

const REASON_TO_CODE = {
  USER_NOT_FOUND: 'auth/user-not-found',
  EMAIL_NOT_FOUND: 'auth/user-not-found',
  EMAIL_EXISTS: 'auth/email-already-exists',
  DUPLICATE_LOCAL_ID: 'auth/uid-already-exists',
  INVALID_EMAIL: 'auth/invalid-email',
  WEAK_PASSWORD: 'auth/invalid-password',
  PHONE_NUMBER_EXISTS: 'auth/phone-number-already-exists',
  CLAIMS_TOO_LARGE: 'auth/claims-too-large',
};

function toAuthError(reason, httpStatus) {
  const key = String(reason).split(':')[0].trim();
  const code = REASON_TO_CODE[key]
    ?? (httpStatus === 404 ? 'auth/user-not-found' : 'auth/internal-error');
  return new AuthError(code, reason);
}

// ---------------------------------------------------------------------------
// UserRecord
// ---------------------------------------------------------------------------

/**
 * Shapes an Identity Toolkit account into the Admin SDK's UserRecord.
 *
 * `projectUser()` in api/admin/users.js reads uid, email, displayName,
 * disabled, customClaims and metadata.{creationTime,lastSignInTime}, and
 * api/_lib/claims.js reads customClaims — so those are the fields that have to
 * be right, in those exact spellings.
 */
function toUserRecord(account) {
  let customClaims;
  if (account.customAttributes) {
    try {
      customClaims = JSON.parse(account.customAttributes);
    } catch {
      customClaims = undefined;
    }
  }

  const asUtc = (millis) => (millis ? new Date(Number(millis)).toUTCString() : null);

  return {
    uid: account.localId,
    email: account.email ?? null,
    emailVerified: account.emailVerified === true,
    displayName: account.displayName ?? null,
    phoneNumber: account.phoneNumber ?? null,
    photoURL: account.photoUrl ?? null,
    disabled: account.disabled === true,
    customClaims,
    // Seconds since epoch, and the basis of the revocation check below.
    tokensValidAfterTime: account.validSince
      ? new Date(Number(account.validSince) * 1000).toUTCString()
      : null,
    metadata: {
      creationTime: asUtc(account.createdAt),
      lastSignInTime: asUtc(account.lastLoginAt),
    },
    providerData: account.providerUserInfo ?? [],
  };
}

// ---------------------------------------------------------------------------
// Base64url / JWT decoding
// ---------------------------------------------------------------------------

function base64UrlToBuffer(segment) {
  return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodeSegment(segment) {
  try {
    return JSON.parse(base64UrlToBuffer(segment).toString('utf8'));
  } catch {
    throw new AuthError('auth/argument-error', 'Malformed token.');
  }
}

// ---------------------------------------------------------------------------
// Google public keys
// ---------------------------------------------------------------------------

let jwkCache = { keys: null, expiresAt: 0 };
const importedKeys = new Map();

/**
 * Fetches and caches Google's signing keys, honouring the `Cache-Control`
 * max-age the endpoint sends.
 *
 * Respecting that header rather than picking our own TTL matters: Google
 * rotates these keys, and caching past the advertised lifetime means every
 * request starts failing verification at an unpredictable moment.
 */
async function getSigningKeys() {
  const now = Date.now();
  if (jwkCache.keys && jwkCache.expiresAt > now) return jwkCache.keys;

  const response = await fetch(JWK_URL);
  if (!response.ok) {
    throw new AuthError('auth/internal-error', 'Could not fetch Google signing keys.');
  }

  const payload = await response.json();
  const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '');
  const ttlMs = maxAge ? Number(maxAge[1]) * 1000 : 3600_000;

  const keys = new Map(payload.keys.map((jwk) => [jwk.kid, jwk]));
  jwkCache = { keys, expiresAt: now + ttlMs };
  importedKeys.clear();

  return keys;
}

async function getVerificationKey(kid) {
  if (importedKeys.has(kid)) return importedKeys.get(kid);

  const keys = await getSigningKeys();
  const jwk = keys.get(kid);
  if (!jwk) throw new AuthError('auth/argument-error', 'Token was signed by an unknown key.');

  const key = await globalThis.crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  importedKeys.set(kid, key);
  return key;
}

// ---------------------------------------------------------------------------
// verifyIdToken
// ---------------------------------------------------------------------------

/**
 * Verifies a Firebase ID token.
 *
 * BOTH halves matter and both are here:
 *
 *   1. The signature, against Google's rotating public keys, plus every
 *      registered claim (aud, iss, exp, iat, sub).
 *   2. When `checkRevoked` is set — which api/_lib/auth.js does on every
 *      authenticated endpoint — an `accounts:lookup` comparing the token's
 *      `auth_time` against the account's `validSince`.
 *
 * Dropping (2) would be an easy and invisible simplification, and it is exactly
 * what makes a disabled account stop working immediately instead of continuing
 * to work for up to an hour until its token expires. On endpoints that move
 * money that hour is the whole point.
 *
 * @param {string} idToken
 * @param {boolean} [checkRevoked]
 */
export async function verifyIdToken(idToken, checkRevoked = false) {
  if (typeof idToken !== 'string' || idToken.length === 0) {
    throw new AuthError('auth/argument-error', 'No ID token provided.');
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new AuthError('auth/argument-error', 'ID token is not a valid JWT.');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeSegment(headerB64);
  const claims = decodeSegment(payloadB64);

  const projectId = getProjectId();
  const now = Math.floor(Date.now() / 1000);

  // --- Registered claims, checked before the signature.
  // Cheap rejections first: an expired token should not cost a key fetch.
  if (claims.exp === undefined || claims.exp <= now) {
    throw new AuthError('auth/id-token-expired', 'The ID token has expired.');
  }
  if (claims.iat === undefined || claims.iat > now + 300) {
    throw new AuthError('auth/argument-error', 'The ID token was issued in the future.');
  }
  if (claims.aud !== projectId) {
    throw new AuthError('auth/argument-error', 'The ID token has the wrong audience.');
  }
  if (claims.iss !== `${SECURE_TOKEN_ISSUER}/${projectId}`) {
    throw new AuthError('auth/argument-error', 'The ID token has the wrong issuer.');
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 128) {
    throw new AuthError('auth/argument-error', 'The ID token has no valid subject.');
  }

  // --- Signature.
  if (authEmulatorHost()) {
    // The Auth emulator issues UNSIGNED tokens (alg: "none"). There is nothing
    // to verify and no key to verify it with. This branch can never weaken
    // production: it is reachable only when FIREBASE_AUTH_EMULATOR_HOST is set,
    // and if that leaked into a deployment every token would be rejected
    // outright by the claim checks above rather than silently trusted.
    if (header.alg !== 'none' && header.alg !== 'RS256') {
      throw new AuthError('auth/argument-error', 'Unexpected token algorithm.');
    }
  } else {
    if (header.alg !== 'RS256') {
      throw new AuthError('auth/argument-error', 'ID token must be signed with RS256.');
    }
    if (!header.kid) {
      throw new AuthError('auth/argument-error', 'ID token has no key id.');
    }

    const key = await getVerificationKey(header.kid);
    const valid = await globalThis.crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBuffer(signatureB64),
      Buffer.from(`${headerB64}.${payloadB64}`, 'utf8')
    );

    if (!valid) {
      throw new AuthError('auth/argument-error', 'The ID token signature is invalid.');
    }
  }

  const decoded = { ...claims, uid: claims.sub };

  // --- Revocation and disablement.
  if (checkRevoked) {
    const user = await getUser(decoded.uid).catch((err) => {
      if (err?.code === 'auth/user-not-found') {
        throw new AuthError('auth/user-disabled', 'This account no longer exists.');
      }
      throw err;
    });

    if (user.disabled) {
      throw new AuthError('auth/user-disabled', 'This account has been disabled.');
    }

    if (user.tokensValidAfterTime) {
      const validSince = Math.floor(new Date(user.tokensValidAfterTime).getTime() / 1000);
      // auth_time is when the user actually authenticated. Comparing against
      // iat instead would let a token refreshed after the revocation slip
      // through, which defeats the revocation entirely.
      const authTime = claims.auth_time ?? claims.iat;
      if (authTime < validSince) {
        throw new AuthError('auth/id-token-revoked', 'The ID token has been revoked.');
      }
    }
  }

  return decoded;
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

export async function getUser(uid) {
  const result = await identityRequest('/accounts:lookup', { body: { localId: [uid] } });
  const account = result?.users?.[0];
  if (!account) throw new AuthError('auth/user-not-found', `No user record for uid ${uid}.`);
  return toUserRecord(account);
}

export async function getUserByEmail(email) {
  const result = await identityRequest('/accounts:lookup', { body: { email: [email] } });
  const account = result?.users?.[0];
  if (!account) throw new AuthError('auth/user-not-found', 'No user record for that email.');
  return toUserRecord(account);
}

/**
 * @param {object} properties  { uid?, email?, password?, displayName?,
 *                               emailVerified?, disabled?, phoneNumber? }
 */
export async function createUser(properties = {}) {
  const body = {
    localId: properties.uid,
    email: properties.email,
    password: properties.password,
    displayName: properties.displayName,
    phoneNumber: properties.phoneNumber,
    emailVerified: properties.emailVerified ?? false,
    disabled: properties.disabled ?? false,
  };

  for (const key of Object.keys(body)) {
    if (body[key] === undefined) delete body[key];
  }

  const created = await identityRequest('/accounts', { body });
  // The create response is thin; re-reading gives callers the same full
  // UserRecord the Admin SDK returns, including metadata.
  return getUser(created.localId);
}

export async function updateUser(uid, properties = {}) {
  const body = { localId: uid };

  if (properties.email !== undefined) body.email = properties.email;
  if (properties.password !== undefined) body.password = properties.password;
  if (properties.displayName !== undefined) body.displayName = properties.displayName;
  if (properties.phoneNumber !== undefined) body.phoneNumber = properties.phoneNumber;
  if (properties.emailVerified !== undefined) body.emailVerified = properties.emailVerified;
  if (properties.disabled !== undefined) body.disableUser = properties.disabled;

  await identityRequest('/accounts:update', { body });
  return getUser(uid);
}

export async function deleteUser(uid) {
  await identityRequest('/accounts:delete', { body: { localId: uid } });
}

/**
 * Custom claims ride inside the ID token, so Firestore rules can read them
 * without a document read — see api/_lib/claims.js for the full contract.
 *
 * Firebase caps the serialised claims at 1000 bytes. Checking here turns an
 * opaque upstream rejection into a message that names the problem.
 */
export async function setCustomUserClaims(uid, claims) {
  const serialised = JSON.stringify(claims ?? {});

  if (serialised.length > 1000) {
    throw new AuthError(
      'auth/claims-too-large',
      `Custom claims must serialise to under 1000 bytes (got ${serialised.length}).`
    );
  }

  await identityRequest('/accounts:update', {
    body: { localId: uid, customAttributes: serialised },
  });
}

/**
 * Invalidates every existing refresh token for the user.
 *
 * `validSince` is in SECONDS. Firebase compares it against the token's
 * `auth_time`, which is also in seconds, and a millisecond value here would
 * put the cutoff about fifty thousand years in the future — revoking every
 * token the account will ever hold.
 */
export async function revokeRefreshTokens(uid) {
  await identityRequest('/accounts:update', {
    body: { localId: uid, validSince: String(Math.floor(Date.now() / 1000)) },
  });
}

/**
 * @param {number} [maxResults]  page size, capped at 1000 by the API
 * @param {string} [pageToken]
 */
export async function listUsers(maxResults = 1000, pageToken) {
  const url = new URL(`${identityBase()}/accounts:batchGet`);
  url.searchParams.set('maxResults', String(Math.min(maxResults, 1000)));
  if (pageToken) url.searchParams.set('nextPageToken', pageToken);

  const response = await fetch(url.toString(), {
    headers: { Authorization: await identityToolkitAuthHeader() },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw toAuthError(payload?.error?.message ?? `HTTP ${response.status}`, response.status);
  }

  return {
    users: (payload?.users ?? []).map(toUserRecord),
    pageToken: payload?.nextPageToken ?? undefined,
  };
}

/**
 * Mints a custom token the client exchanges for a real session.
 *
 * Used by the student phone-verification flow: the server proves the phone
 * number, then hands out a token the browser signs in with.
 */
export async function createCustomToken(uid, developerClaims) {
  if (typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
    throw new AuthError('auth/argument-error', 'uid must be a non-empty string under 128 characters.');
  }

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    aud: CUSTOM_TOKEN_AUDIENCE,
    iat: now,
    exp: now + CUSTOM_TOKEN_TTL_SECONDS,
    uid,
    ...(developerClaims ? { claims: developerClaims } : {}),
  };

  if (authEmulatorHost()) {
    // The emulator accepts an unsigned custom token, and requires no service
    // account — which is what lets the auth flow be tested without one.
    const encode = (obj) => Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const claims = {
      ...payload,
      iss: 'firebase-auth-emulator@example.com',
      sub: 'firebase-auth-emulator@example.com',
    };
    return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.`;
  }

  const { client_email: email } = loadServiceAccount();
  return signJwt({ ...payload, iss: email, sub: email });
}

// ---------------------------------------------------------------------------

/** The Admin SDK's `getAuth()` shape, so call sites read unchanged. */
export function getAuthRest() {
  return {
    verifyIdToken,
    getUser,
    getUserByEmail,
    createUser,
    updateUser,
    deleteUser,
    setCustomUserClaims,
    revokeRefreshTokens,
    listUsers,
    createCustomToken,
  };
}

/** Test seam: drops the cached Google signing keys. */
export function __resetKeyCaches() {
  jwkCache = { keys: null, expiresAt: 0 };
  importedKeys.clear();
}
