/**
 * Google service-account credentials without the Admin SDK — Phase 12 D1.
 *
 * `firebase-admin` cannot run on Cloudflare Workers: it reaches for gRPC,
 * `http2`, `net`, `tls`, `dns` and `fs`, none of which `nodejs_compat` provides.
 * This module replaces the one thing the Admin SDK was actually doing for us at
 * the credential layer — turning a service-account JSON blob into an
 * `Authorization` header — using only `fetch` and Web Crypto.
 *
 * It therefore runs unchanged in Workers AND in plain Node, which is why
 * `scripts/seedSuperadmin.js` and friends keep working with no changes.
 *
 * ---------------------------------------------------------------------------
 * TWO TOKEN PATHS, because Google wants different things from different APIs
 * ---------------------------------------------------------------------------
 *
 *   Firestore  — accepts a SELF-SIGNED JWT. We sign a token with the service
 *                account key, set `aud` to the Firestore service name, and send
 *                it directly. There is NO network round trip to mint it.
 *
 *                That is not a micro-optimisation. Cloudflare's free plan
 *                allows 50 external subrequests per invocation, and every
 *                Firestore REST call spends one. Paying an extra subrequest to
 *                fetch a token we can produce locally would cut the budget for
 *                real work by a meaningful fraction on a sweep.
 *
 *   Identity   — will NOT accept a self-signed JWT. It needs a real OAuth2
 *   Toolkit /   access token, obtained with the JWT-bearer grant
 *   Storage     (RFC 7523): sign an assertion, POST it to Google's token
 *                endpoint, receive a bearer token good for about an hour.
 *                One subrequest, then cached until it expires.
 *
 * ---------------------------------------------------------------------------
 * CACHING
 * ---------------------------------------------------------------------------
 *
 * The imported `CryptoKey` and every minted token are cached at module scope,
 * so a warm isolate never signs twice. This is the main mitigation for the free
 * plan's 10ms CPU budget — an RSA signature is cheap but not free, and doing one
 * per request when the previous one is still valid for 55 minutes is waste we
 * cannot afford at that ceiling.
 *
 * In-flight requests are deduplicated by caching the PROMISE rather than the
 * resolved value. Without that, ten concurrent cold requests would fire ten
 * identical token exchanges.
 */

const FIRESTORE_AUDIENCE = 'https://firestore.googleapis.com/google.firestore.v1.Firestore';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

/** Token lifetime Google allows for a self-signed assertion. */
const TOKEN_TTL_SECONDS = 3600;

/**
 * Refresh this many seconds before actual expiry. A token that expires while
 * in flight produces a 401 on a request that had already passed authorization,
 * which is a confusing failure to debug and trivial to avoid.
 */
const EXPIRY_SKEW_SECONDS = 60;

/**
 * Least-privilege scope sets. Cached separately, so asking for a Storage token
 * does not hand Identity Toolkit permissions to the Storage code path.
 */
export const SCOPES = {
  identityToolkit: [
    'https://www.googleapis.com/auth/identitytoolkit',
    'https://www.googleapis.com/auth/firebase',
  ],
  storage: ['https://www.googleapis.com/auth/devstorage.read_write'],
};

// ---------------------------------------------------------------------------
// Emulator detection
// ---------------------------------------------------------------------------

/**
 * The emulators accept `Bearer owner` and verify nothing. Detecting them here
 * — rather than in each REST module — is what lets the existing emulator test
 * suites (`npm run test:handlers`, `npm run test:rules`) run against these
 * shims with no service account present, which in turn makes them a genuine
 * correctness oracle rather than a smoke test.
 */
export function firestoreEmulatorHost() {
  return process.env.FIRESTORE_EMULATOR_HOST || null;
}

export function authEmulatorHost() {
  return process.env.FIREBASE_AUTH_EMULATOR_HOST || null;
}

// ---------------------------------------------------------------------------
// Service account
// ---------------------------------------------------------------------------

let cachedServiceAccount = null;

/**
 * Parses `FIREBASE_SERVICE_ACCOUNT`, accepting either the raw JSON or a
 * base64-encoded copy of it. Both forms are in the wild because some hosts
 * mangle multi-line values and base64 is the usual workaround.
 *
 * Behaviour preserved verbatim from the Admin SDK loader this replaces,
 * including the `\n` restoration — environment variables flatten the real
 * newlines in a PEM body, and an unrestored key fails to import with an error
 * that does not mention newlines.
 */
export function loadServiceAccount() {
  if (cachedServiceAccount) return cachedServiceAccount;

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

  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is missing one of client_email, private_key or project_id.'
    );
  }

  cachedServiceAccount = parsed;
  return cachedServiceAccount;
}

/**
 * Project ID, resolved without requiring a credential when an emulator is in
 * play — the emulator needs a project ID but has no service account to read one
 * from. The `demo-` default matches the ID the existing test suites use.
 */
export function getProjectId() {
  if (firestoreEmulatorHost() || authEmulatorHost()) {
    return process.env.GCLOUD_PROJECT || 'demo-online-tutoring';
  }
  return loadServiceAccount().project_id;
}

// ---------------------------------------------------------------------------
// Base64url
// ---------------------------------------------------------------------------

/**
 * Written against plain base64 rather than Node's `'base64url'` encoding, so
 * the same code holds regardless of how complete a given runtime's `Buffer`
 * polyfill is. JWTs are unforgiving about a stray `+`, `/` or `=`.
 */
function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Key import and signing
// ---------------------------------------------------------------------------

let cachedKeyPromise = null;

/**
 * Imports the PEM private key as a Web Crypto `CryptoKey`.
 *
 * `crypto.subtle` is reached through `globalThis` deliberately. It is the one
 * spelling that is correct in both the Workers runtime and Node 18+, whereas
 * importing `webcrypto` from `node:crypto` would tie this module to a
 * particular runtime's module shape.
 *
 * The key is imported as non-extractable: nothing in this process ever needs to
 * read the raw bytes back out, so there is no reason to leave them reachable
 * from a heap dump or an accidental log line.
 */
function importPrivateKey() {
  if (cachedKeyPromise) return cachedKeyPromise;

  cachedKeyPromise = (async () => {
    const { private_key: pem } = loadServiceAccount();

    const body = pem
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');

    const der = Buffer.from(body, 'base64');

    return globalThis.crypto.subtle.importKey(
      'pkcs8',
      // A fresh ArrayBuffer slice: Buffer views share a pooled backing store in
      // Node, and handing that pool to importKey passes far more than the key.
      der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  })();

  // A failed import must not be cached as a permanent failure — a transient
  // problem would then poison the isolate for its whole lifetime.
  cachedKeyPromise.catch(() => {
    cachedKeyPromise = null;
  });

  return cachedKeyPromise;
}

/**
 * Signs a JWT with RS256, the only algorithm Google accepts for a
 * service-account assertion.
 */
export async function signJwt(claims) {
  const { private_key_id: keyId } = loadServiceAccount();

  const header = { alg: 'RS256', typ: 'JWT', ...(keyId ? { kid: keyId } : {}) };

  const signingInput =
    `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;

  const key = await importPrivateKey();
  const signature = await globalThis.crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    Buffer.from(signingInput, 'utf8')
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Signs arbitrary bytes with the service-account key, returning STANDARD
 * base64 (not base64url).
 *
 * Separate from `signJwt` because Cloud Storage's V2 signed-URL scheme signs a
 * plain canonical string rather than a JWT, and expects standard base64 which
 * is then percent-encoded into the query string. Feeding it base64url would
 * produce a URL that looks right and fails to verify.
 */
export async function signBytes(data) {
  const key = await importPrivateKey();
  const signature = await globalThis.crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)
  );
  return Buffer.from(signature).toString('base64');
}

// ---------------------------------------------------------------------------
// Firestore: self-signed JWT, no network call
// ---------------------------------------------------------------------------

let cachedFirestoreToken = { promise: null, expiresAt: 0 };

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * The `Authorization` header value for a Firestore REST call.
 *
 * `sub` and `iss` are both the service-account email, and `aud` is the
 * Firestore service name rather than a URL path — that combination is what
 * makes Google accept the assertion directly instead of demanding it be
 * exchanged for an access token first.
 */
export async function firestoreAuthHeader() {
  // The emulator authorizes nothing. Signing here would require a service
  // account that tests deliberately do not provide.
  if (firestoreEmulatorHost()) return 'Bearer owner';

  const now = nowSeconds();
  if (cachedFirestoreToken.promise && cachedFirestoreToken.expiresAt > now) {
    return `Bearer ${await cachedFirestoreToken.promise}`;
  }

  const { client_email: email } = loadServiceAccount();

  const promise = signJwt({
    iss: email,
    sub: email,
    aud: FIRESTORE_AUDIENCE,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  });

  cachedFirestoreToken = {
    promise,
    expiresAt: now + TOKEN_TTL_SECONDS - EXPIRY_SKEW_SECONDS,
  };

  promise.catch(() => {
    cachedFirestoreToken = { promise: null, expiresAt: 0 };
  });

  return `Bearer ${await promise}`;
}

// ---------------------------------------------------------------------------
// Identity Toolkit / Storage: OAuth2 JWT-bearer exchange
// ---------------------------------------------------------------------------

const cachedAccessTokens = new Map();

/**
 * Exchanges a signed assertion for a real OAuth2 access token.
 *
 * Cached per scope set. The cache holds the in-flight promise, not the settled
 * value, so a burst of concurrent callers on a cold isolate performs exactly
 * one exchange between them rather than one each.
 *
 * @param {string[]} scopes
 * @returns {Promise<string>} the raw access token
 */
export async function getAccessToken(scopes) {
  const scopeKey = [...scopes].sort().join(' ');
  const now = nowSeconds();

  const cached = cachedAccessTokens.get(scopeKey);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (async () => {
    const { client_email: email } = loadServiceAccount();

    const assertion = await signJwt({
      iss: email,
      scope: scopeKey,
      aud: OAUTH_TOKEN_URL,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    });

    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.access_token) {
      // Google's error body names the misconfiguration (clock skew, a disabled
      // key, a missing API) and contains no secret material, so it is worth
      // keeping. It goes into the thrown Error, which handlers log rather than
      // return — see sendError in ./errors.js.
      throw new Error(
        `Google token exchange failed (${response.status}): ` +
        `${payload?.error ?? 'unknown'} ${payload?.error_description ?? ''}`.trim()
      );
    }

    return payload.access_token;
  })();

  // Honour the lifetime Google actually returned rather than assuming an hour.
  cachedAccessTokens.set(scopeKey, {
    promise,
    expiresAt: now + TOKEN_TTL_SECONDS - EXPIRY_SKEW_SECONDS,
  });

  promise
    .then((token) => {
      const entry = cachedAccessTokens.get(scopeKey);
      if (entry?.promise === promise) entry.expiresAt = now + TOKEN_TTL_SECONDS - EXPIRY_SKEW_SECONDS;
      return token;
    })
    .catch(() => {
      const entry = cachedAccessTokens.get(scopeKey);
      if (entry?.promise === promise) cachedAccessTokens.delete(scopeKey);
    });

  return promise;
}

/** `Authorization` header for Identity Toolkit (user management). */
export async function identityToolkitAuthHeader() {
  if (authEmulatorHost()) return 'Bearer owner';
  return `Bearer ${await getAccessToken(SCOPES.identityToolkit)}`;
}

/** `Authorization` header for Cloud Storage. */
export async function storageAuthHeader() {
  return `Bearer ${await getAccessToken(SCOPES.storage)}`;
}

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

/**
 * Drops every cached credential. Exported for tests, which switch between
 * emulator and signed modes inside a single process and would otherwise see a
 * token minted under the previous configuration.
 */
export function __resetCredentialCaches() {
  cachedServiceAccount = null;
  cachedKeyPromise = null;
  cachedFirestoreToken = { promise: null, expiresAt: 0 };
  cachedAccessTokens.clear();
}
