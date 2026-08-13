// @vitest-environment node

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, createSign, createPublicKey } from 'node:crypto';

/**
 * Firebase ID token verification — Phase 12 D3.
 *
 * This is the only thing standing between an attacker and every authenticated
 * endpoint, so it is tested directly rather than through a handler. Each check
 * gets its own case with a token that violates exactly one rule, because a
 * verifier that rejects a wholly bogus token proves very little — the
 * interesting failures are the tokens that are correct in every respect but
 * one.
 */

const PROJECT_ID = 'test-project';
const KID = 'test-key-1';

let authRest;
let privateKeyPem;
let publicJwk;

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Builds a genuinely signed ID token, then lets each test break one claim. */
function makeToken(overrides = {}, { sign = true, alg = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg, typ: 'JWT', ...(alg === 'RS256' ? { kid: KID } : {}) };
  const claims = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: 'uid-123',
    auth_time: now - 60,
    iat: now - 60,
    exp: now + 3600,
    ...overrides,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  if (!sign) return `${signingInput}.`;

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(privateKeyPem);

  return `${signingInput}.${b64url(signature)}`;
}

beforeAll(async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  privateKeyPem = privateKey;
  const jwk = createPublicKey(publicKey).export({ format: 'jwk' });
  publicJwk = { kid: KID, kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig' };

  authRest = await import('../../api/_lib/authRest.js');
});

beforeEach(async () => {
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    project_id: PROJECT_ID,
    client_email: 'svc@test-project.iam.gserviceaccount.com',
    private_key: privateKeyPem,
    private_key_id: KID,
  });

  const google = await import('../../api/_lib/googleAuth.js');
  google.__resetCredentialCaches();
  authRest.__resetKeyCaches();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Stubs the two Google endpoints every path here needs — the JWK set for
 * signature verification and the OAuth2 token exchange that Identity Toolkit
 * calls authenticate with — and delegates anything else to `extra`.
 *
 * Unmatched URLs deliberately 404 rather than passing through, so a test that
 * accidentally reaches the real internet fails instead of quietly succeeding.
 */
function stubJwkEndpoint(extra) {
  const fetchMock = vi.fn(async (url, init) => {
    const href = String(url);

    if (href.includes('/jwk/securetoken')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'cache-control': 'public, max-age=3600' }),
        json: async () => ({ keys: [publicJwk] }),
      };
    }

    if (href.includes('oauth2.googleapis.com/token')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ access_token: 'ya29.test', expires_in: 3599 }),
      };
    }

    if (extra) return extra(href, init);
    return { ok: false, status: 404, json: async () => ({ error: { message: 'NOT_FOUND' } }) };
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Convenience for tests that only care about the Identity Toolkit response. */
function stubIdentity(handler) {
  return stubJwkEndpoint((href, init) => handler(href, init));
}

// ---------------------------------------------------------------------------

describe('verifyIdToken — accepting a valid token', () => {
  it('accepts a correctly signed token and returns its claims', async () => {
    stubJwkEndpoint();

    const decoded = await authRest.verifyIdToken(makeToken());

    expect(decoded.uid).toBe('uid-123');
    expect(decoded.sub).toBe('uid-123');
    expect(decoded.aud).toBe(PROJECT_ID);
  });

  it('passes through custom claims the handlers depend on', async () => {
    stubJwkEndpoint();

    const decoded = await authRest.verifyIdToken(
      makeToken({ role: 'teacher', tier: 'gold', tierRank: 3, subActive: true })
    );

    // api/_lib/auth.js reads exactly these off the decoded token.
    expect(decoded.role).toBe('teacher');
    expect(decoded.tierRank).toBe(3);
    expect(decoded.subActive).toBe(true);
  });

  it('caches Google\'s signing keys instead of refetching per request', async () => {
    const fetchMock = stubJwkEndpoint();

    await authRest.verifyIdToken(makeToken());
    await authRest.verifyIdToken(makeToken());

    const jwkCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/jwk/'));
    expect(jwkCalls).toHaveLength(1);
  });
});

describe('verifyIdToken — rejecting', () => {
  it('rejects a tampered payload', async () => {
    stubJwkEndpoint();

    const token = makeToken();
    const [header, , signature] = token.split('.');
    // Same signature, escalated claims. This is THE attack.
    const forged = b64url(JSON.stringify({
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      aud: PROJECT_ID,
      sub: 'uid-123',
      role: 'superadmin',
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }));

    await expect(authRest.verifyIdToken(`${header}.${forged}.${signature}`))
      .rejects.toThrow(/signature is invalid/);
  });

  it('rejects a token signed by a different key', async () => {
    stubJwkEndpoint();

    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID }));
    const payload = b64url(JSON.stringify({
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      aud: PROJECT_ID, sub: 'uid-123', iat: now - 60, exp: now + 3600,
    }));

    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);

    await expect(
      authRest.verifyIdToken(`${header}.${payload}.${b64url(signer.sign(other.privateKey))}`)
    ).rejects.toThrow(/signature is invalid/);
  });

  it('rejects an unsigned token outside the emulator', async () => {
    // alg:none is the classic JWT downgrade. It must never be accepted in
    // production, and the emulator branch must not be reachable without
    // FIREBASE_AUTH_EMULATOR_HOST.
    stubJwkEndpoint();

    await expect(authRest.verifyIdToken(makeToken({}, { sign: false, alg: 'none' })))
      .rejects.toThrow(/RS256/);
  });

  it('reports an expired token with the code auth/id-token-expired', async () => {
    stubJwkEndpoint();
    const now = Math.floor(Date.now() / 1000);

    const error = await authRest
      .verifyIdToken(makeToken({ exp: now - 10, iat: now - 3600 }))
      .catch((e) => e);

    // api/_lib/auth.js:64 branches on this exact code to say "your session has
    // expired, sign in again" rather than a generic failure.
    expect(error.code).toBe('auth/id-token-expired');
  });

  it('rejects a token minted for another Firebase project', async () => {
    stubJwkEndpoint();

    await expect(authRest.verifyIdToken(makeToken({ aud: 'someone-elses-project' })))
      .rejects.toThrow(/wrong audience/);
  });

  it('rejects a token with the wrong issuer', async () => {
    stubJwkEndpoint();

    await expect(authRest.verifyIdToken(makeToken({ iss: 'https://evil.example.com/x' })))
      .rejects.toThrow(/wrong issuer/);
  });

  it('rejects a token with no subject', async () => {
    stubJwkEndpoint();

    await expect(authRest.verifyIdToken(makeToken({ sub: '' })))
      .rejects.toThrow(/no valid subject/);
  });

  it('rejects a token signed by an unknown key id', async () => {
    stubJwkEndpoint();

    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'rotated-away' }));
    const payload = b64url(JSON.stringify({
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      aud: PROJECT_ID, sub: 'uid-123', iat: now - 60, exp: now + 3600,
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);

    await expect(authRest.verifyIdToken(`${header}.${payload}.${b64url(signer.sign(privateKeyPem))}`))
      .rejects.toThrow(/unknown key/);
  });

  it('rejects garbage without throwing something unhelpful', async () => {
    stubJwkEndpoint();

    await expect(authRest.verifyIdToken('not-a-jwt')).rejects.toThrow(/not a valid JWT/);
    await expect(authRest.verifyIdToken('')).rejects.toThrow(/No ID token/);
  });
});

describe('verifyIdToken — checkRevoked', () => {
  const lookupReturning = (account) => (url) => {
    if (String(url).includes('accounts:lookup')) {
      return { ok: true, status: 200, json: async () => ({ users: [account] }) };
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'NOT_FOUND' } }) };
  };

  it('does no lookup at all when checkRevoked is false', async () => {
    const fetchMock = stubJwkEndpoint();

    await authRest.verifyIdToken(makeToken(), false);

    const lookups = fetchMock.mock.calls.filter(([u]) => String(u).includes('accounts:lookup'));
    expect(lookups).toHaveLength(0);
  });

  it('accepts a token issued after validSince', async () => {
    const now = Math.floor(Date.now() / 1000);
    stubJwkEndpoint(lookupReturning({
      localId: 'uid-123',
      validSince: String(now - 3600),
    }));

    const decoded = await authRest.verifyIdToken(makeToken({ auth_time: now - 60 }), true);
    expect(decoded.uid).toBe('uid-123');
  });

  it('rejects a token issued BEFORE validSince with auth/id-token-revoked', async () => {
    // This is the whole reason checkRevoked exists: without the lookup, a
    // signed-out or compromised session keeps working until the token expires,
    // up to an hour later, on endpoints that move money.
    const now = Math.floor(Date.now() / 1000);
    stubJwkEndpoint(lookupReturning({
      localId: 'uid-123',
      validSince: String(now - 30),
    }));

    const error = await authRest
      .verifyIdToken(makeToken({ auth_time: now - 600, iat: now - 600 }), true)
      .catch((e) => e);

    expect(error.code).toBe('auth/id-token-revoked');
  });

  it('compares against auth_time, not iat', async () => {
    // A token REFRESHED after revocation has a fresh iat but keeps the original
    // auth_time. Comparing iat would let exactly the session we revoked back in.
    const now = Math.floor(Date.now() / 1000);
    stubJwkEndpoint(lookupReturning({
      localId: 'uid-123',
      validSince: String(now - 100),
    }));

    const error = await authRest
      .verifyIdToken(makeToken({ auth_time: now - 600, iat: now - 5 }), true)
      .catch((e) => e);

    expect(error.code).toBe('auth/id-token-revoked');
  });

  it('rejects a disabled account outright', async () => {
    stubJwkEndpoint(lookupReturning({ localId: 'uid-123', disabled: true }));

    const error = await authRest.verifyIdToken(makeToken(), true).catch((e) => e);
    expect(error.code).toBe('auth/user-disabled');
  });
});

// ---------------------------------------------------------------------------

describe('user records', () => {
  it('maps an Identity Toolkit account onto the Admin SDK shape', async () => {
    const created = Date.now() - 86_400_000;
    stubIdentity(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        users: [{
          localId: 'uid-9',
          email: 'teacher@example.com',
          displayName: 'Amina',
          disabled: false,
          customAttributes: JSON.stringify({ role: 'teacher', tier: 'gold', tierRank: 3 }),
          createdAt: String(created),
          lastLoginAt: String(created + 3600_000),
        }],
      }),
    }));

    const user = await authRest.getUser('uid-9');

    // These exact spellings are what projectUser() in api/admin/users.js reads.
    expect(user.uid).toBe('uid-9');
    expect(user.email).toBe('teacher@example.com');
    expect(user.displayName).toBe('Amina');
    expect(user.disabled).toBe(false);
    expect(user.customClaims).toEqual({ role: 'teacher', tier: 'gold', tierRank: 3 });
    expect(user.metadata.creationTime).toBe(new Date(created).toUTCString());
    expect(user.metadata.lastSignInTime).toBe(new Date(created + 3600_000).toUTCString());
  });

  it('throws auth/user-not-found when the account is absent', async () => {
    // api/_lib/claims.js:84 and api/student/verifyCode.js:95 both branch on
    // this code — the latter creates the account in response.
    stubIdentity(async () => ({ ok: true, status: 200, json: async () => ({ users: [] }) }));

    const error = await authRest.getUser('missing').catch((e) => e);
    expect(error.code).toBe('auth/user-not-found');
  });

  it('translates EMAIL_EXISTS into auth/email-already-exists', async () => {
    stubIdentity(async () => ({
      ok: false, status: 400, json: async () => ({ error: { message: 'EMAIL_EXISTS' } }),
    }));

    const error = await authRest.createUser({ email: 'taken@example.com' }).catch((e) => e);
    expect(error.code).toBe('auth/email-already-exists');
  });

  it('refuses custom claims over the 1000-byte Firebase limit', async () => {
    const error = await authRest
      .setCustomUserClaims('uid-9', { blob: 'x'.repeat(1200) })
      .catch((e) => e);

    expect(error.code).toBe('auth/claims-too-large');
  });

  it('revokes using SECONDS, not milliseconds', async () => {
    // A millisecond value here would put the cutoff ~50,000 years out and
    // permanently revoke every token the account will ever hold.
    const fetchMock = stubIdentity(async () => ({
      ok: true, status: 200, json: async () => ({}),
    }));

    await authRest.revokeRefreshTokens('uid-9');

    const updateCall = fetchMock.mock.calls.find(([u]) => String(u).includes('accounts:update'));
    const body = JSON.parse(updateCall[1].body);
    const validSince = Number(body.validSince);
    const nowSeconds = Math.floor(Date.now() / 1000);

    expect(Math.abs(validSince - nowSeconds)).toBeLessThan(5);
  });
});

describe('createCustomToken', () => {
  it('signs with the identitytoolkit audience and carries the uid', async () => {
    const token = await authRest.createCustomToken('uid-123', { role: 'student', phone: '+254700000000' });
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    );

    expect(claims.aud).toBe(
      'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'
    );
    expect(claims.uid).toBe('uid-123');
    expect(claims.claims).toEqual({ role: 'student', phone: '+254700000000' });
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it('rejects an oversized uid', async () => {
    await expect(authRest.createCustomToken('x'.repeat(200))).rejects.toThrow(/128/);
  });
});
