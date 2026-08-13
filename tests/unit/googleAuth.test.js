// @vitest-environment node
//
// Node rather than the project default of jsdom: this module signs with Web
// Crypto, and jsdom shadows `globalThis.crypto` with a stub that has no
// `subtle`. The production code is correct in both Workers and Node; only the
// test harness needs telling.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, createVerify, createPublicKey } from 'node:crypto';

/**
 * Service-account credential handling — Phase 12 D1.
 *
 * This is the module that turns a private key into an Authorization header, so
 * a defect here is either "nothing works" or, much worse, "we signed something
 * with the wrong audience and it was accepted somewhere we did not intend".
 * Both halves get direct tests.
 */

let auth;
let publicKeyPem;
let serviceAccount;

const decodeSegment = (segment) =>
  JSON.parse(Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

beforeAll(async () => {
  // 2048 is the smallest size Google accepts and keeps the suite fast.
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  publicKeyPem = publicKey;
  serviceAccount = {
    type: 'service_account',
    project_id: 'test-project',
    private_key_id: 'key-1',
    private_key: privateKey,
    client_email: 'svc@test-project.iam.gserviceaccount.com',
  };

  auth = await import('../../api/_lib/googleAuth.js');
});

beforeEach(() => {
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  delete process.env.GCLOUD_PROJECT;
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(serviceAccount);
  auth.__resetCredentialCaches();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('loadServiceAccount', () => {
  it('parses raw JSON', () => {
    expect(auth.loadServiceAccount().client_email).toBe(serviceAccount.client_email);
  });

  it('parses a base64-encoded copy', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(
      JSON.stringify(serviceAccount)
    ).toString('base64');
    auth.__resetCredentialCaches();

    expect(auth.loadServiceAccount().project_id).toBe('test-project');
  });

  it('restores newlines flattened by the environment', () => {
    // This is what actually happens when a PEM is pasted into a dashboard env
    // var: the real newlines arrive as the two characters backslash-n. An
    // unrestored key fails to import with an error that never mentions
    // newlines, so it is worth pinning.
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      ...serviceAccount,
      private_key: serviceAccount.private_key.replace(/\n/g, '\\n'),
    });
    auth.__resetCredentialCaches();

    expect(auth.loadServiceAccount().private_key).toBe(serviceAccount.private_key);
  });

  it('throws a directive error when the variable is absent', () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    auth.__resetCredentialCaches();

    expect(() => auth.loadServiceAccount()).toThrow(/FIREBASE_SERVICE_ACCOUNT is not set/);
  });

  it('rejects a credential missing a required field', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'x' });
    auth.__resetCredentialCaches();

    expect(() => auth.loadServiceAccount()).toThrow(/missing one of/);
  });
});

describe('getProjectId', () => {
  it('reads the project from the credential', () => {
    expect(auth.getProjectId()).toBe('test-project');
  });

  it('does not require a credential when an emulator is configured', () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
    process.env.GCLOUD_PROJECT = 'demo-online-tutoring';
    auth.__resetCredentialCaches();

    expect(auth.getProjectId()).toBe('demo-online-tutoring');
  });
});

// ---------------------------------------------------------------------------

describe('signJwt', () => {
  it('produces a token whose signature verifies against the public key', async () => {
    const token = await auth.signJwt({ iss: 'a', aud: 'b', iat: 1, exp: 2 });
    const [header, payload, signature] = token.split('.');

    expect(token.split('.')).toHaveLength(3);

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);

    const ok = verifier.verify(
      createPublicKey(publicKeyPem),
      Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    );

    // If this fails the signing algorithm or the encoding is wrong, and Google
    // would reject every call we make.
    expect(ok).toBe(true);
  });

  it('declares RS256 and carries the key id', async () => {
    const token = await auth.signJwt({ iss: 'a' });
    const header = decodeSegment(token.split('.')[0]);

    expect(header).toMatchObject({ alg: 'RS256', typ: 'JWT', kid: 'key-1' });
  });

  it('emits base64url with no padding or unsafe characters', async () => {
    // A stray '+', '/' or '=' anywhere in a JWT makes it unparseable at the
    // far end, and the resulting error does not say so.
    const token = await auth.signJwt({ iss: 'a', pad: 'x'.repeat(61) });
    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
});

// ---------------------------------------------------------------------------

describe('firestoreAuthHeader', () => {
  it('returns the emulator owner token without signing', async () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
    auth.__resetCredentialCaches();

    expect(await auth.firestoreAuthHeader()).toBe('Bearer owner');
  });

  it('self-signs with the Firestore service as the audience', async () => {
    const header = await auth.firestoreAuthHeader();
    expect(header.startsWith('Bearer ')).toBe(true);

    const claims = decodeSegment(header.slice(7).split('.')[1]);

    // `aud` being the service name rather than a URL is precisely what lets
    // Firestore accept this assertion directly, with no token exchange and so
    // no subrequest spent.
    expect(claims.aud).toBe('https://firestore.googleapis.com/google.firestore.v1.Firestore');
    expect(claims.iss).toBe(serviceAccount.client_email);
    expect(claims.sub).toBe(serviceAccount.client_email);
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it('reuses a cached token rather than signing on every call', async () => {
    const first = await auth.firestoreAuthHeader();
    const second = await auth.firestoreAuthHeader();

    // Byte-identical means no second signature was computed. On the free
    // plan's 10ms CPU budget that reuse is the difference between comfortable
    // and marginal.
    expect(second).toBe(first);
  });

  it('makes no network request at all', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await auth.firestoreAuthHeader();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('getAccessToken', () => {
  const okResponse = (token = 'ya29.test') => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: token, expires_in: 3599, token_type: 'Bearer' }),
  });

  it('exchanges a signed assertion for an access token', async () => {
    const fetchSpy = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchSpy);

    const token = await auth.getAccessToken(auth.SCOPES.identityToolkit);
    expect(token).toBe('ya29.test');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');

    const body = new URLSearchParams(init.body.toString());
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');

    const claims = decodeSegment(body.get('assertion').split('.')[1]);
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect(claims.scope).toContain('identitytoolkit');
  });

  it('caches per scope set', async () => {
    const fetchSpy = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchSpy);

    await auth.getAccessToken(auth.SCOPES.identityToolkit);
    await auth.getAccessToken(auth.SCOPES.identityToolkit);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // A different scope set is a different token, and must not be served from
    // the first one's cache — that would silently hand Storage permissions to
    // an Identity Toolkit caller or vice versa.
    await auth.getAccessToken(auth.SCOPES.storage);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('treats scope order as irrelevant to the cache key', async () => {
    const fetchSpy = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchSpy);

    await auth.getAccessToken(['b', 'a']);
    await auth.getAccessToken(['a', 'b']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('performs one exchange for concurrent callers', async () => {
    const fetchSpy = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchSpy);

    const tokens = await Promise.all([
      auth.getAccessToken(auth.SCOPES.storage),
      auth.getAccessToken(auth.SCOPES.storage),
      auth.getAccessToken(auth.SCOPES.storage),
    ]);

    // Caching the promise rather than the settled value is what collapses a
    // cold-start burst into a single round trip.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(new Set(tokens).size).toBe(1);
  });

  it('surfaces Google\'s error text and does not cache the failure', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_description: 'Invalid JWT: clock skew' }),
      })
      .mockResolvedValueOnce(okResponse('ya29.recovered'));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(auth.getAccessToken(auth.SCOPES.storage)).rejects.toThrow(/invalid_grant/);

    // A transient failure must not poison the isolate for its whole lifetime.
    await expect(auth.getAccessToken(auth.SCOPES.storage)).resolves.toBe('ya29.recovered');
  });
});

describe('identityToolkitAuthHeader', () => {
  it('short-circuits to the owner token under the auth emulator', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

    expect(await auth.identityToolkitAuthHeader()).toBe('Bearer owner');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
