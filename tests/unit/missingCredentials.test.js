// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * What a deployment with no service account does — Phase 12.
 *
 * This suite exists because of a real incident. The first Cloudflare deploy
 * went out before `FIREBASE_SERVICE_ACCOUNT` had been uploaded as a secret,
 * and the resulting symptoms pointed at the code rather than the config:
 *
 *   /api/health          → firestore: "unreachable"  (true, and unhelpful)
 *   /api/admin/users     → 500 internal_error        (rate-limited route)
 *   /api/billing/status  → 401 unauthorized          (no rate limit)
 *
 * The 500 was the misleading one. `checkRateLimit` promises in its own comment
 * to fail OPEN on limiter infrastructure failure, but built its Firestore
 * handle OUTSIDE the try — and building that handle is what parses the service
 * account. So a missing variable escaped as an unhandled error on every
 * rate-limited endpoint, which reads as a bug in the endpoint.
 *
 * Both halves are pinned here: the limiter must stay open, and /api/health
 * must name the cause well enough to end the investigation in one request.
 */

const REAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
});

afterEach(() => {
  process.env = { ...REAL_ENV };
});

describe('rate limiter with no credentials', () => {
  it('fails open rather than throwing', async () => {
    const { checkRateLimit } = await import('../../api/_lib/rateLimit.js');

    const result = await checkRateLimit({
      key: '196.201.214.200',
      bucket: 'admin_users',
      limit: 120,
      windowSeconds: 3600,
    });

    // Open, not closed: a credential problem must not also take down every
    // endpoint that happens to be rate limited.
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(120);
  });

  it('still fails open when the credential is present but malformed', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"x"'; // truncated JSON

    const { checkRateLimit } = await import('../../api/_lib/rateLimit.js');

    await expect(
      checkRateLimit({ key: 'ip', bucket: 'b', limit: 5, windowSeconds: 60 })
    ).resolves.toMatchObject({ allowed: true });
  });
});

/** Minimal Node-style res, enough for createHandler. */
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    writableEnded: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.writableEnded = true; return this; },
  };
  return res;
}

describe('/api/health credential reporting', () => {
  it('reports "missing" when the variable is not set at all', async () => {
    const handler = (await import('../../api/health.js')).default;
    const res = mockRes();

    await handler({ method: 'GET', headers: {}, query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.credentials).toBe('missing');
    expect(res.body.firestore).toBe('unreachable');
    expect(res.body.status).toBe('degraded');
  });

  it('reports "invalid" when the variable is set but unparseable', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = 'not-json-and-not-base64-json';

    const handler = (await import('../../api/health.js')).default;
    const res = mockRes();

    await handler({ method: 'GET', headers: {}, query: {} }, res);

    // A different word from "missing", because it has a different fix: the
    // value arrived and was mangled, rather than never arriving.
    expect(res.body.credentials).toBe('invalid');
  });

  it('reports "invalid" when the JSON parses but lacks a private key', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: 'online-tutoring',
      client_email: 'x@y.iam.gserviceaccount.com',
    });

    const handler = (await import('../../api/health.js')).default;
    const res = mockRes();

    await handler({ method: 'GET', headers: {}, query: {} }, res);

    expect(res.body.credentials).toBe('invalid');
  });

  it('never names a variable or echoes any part of a value', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: 'super-secret-project',
      client_email: 'leaky@example.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----AAAA-----END PRIVATE KEY-----',
    });

    const handler = (await import('../../api/health.js')).default;
    const res = mockRes();

    await handler({ method: 'GET', headers: {}, query: {} }, res);

    // This endpoint is unauthenticated and is the most-scanned path on any
    // deployment. Three fixed words is the whole contract.
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toMatch(/FIREBASE_SERVICE_ACCOUNT/);
    expect(serialised).not.toMatch(/super-secret-project/);
    expect(serialised).not.toMatch(/leaky@/);
    expect(serialised).not.toMatch(/PRIVATE KEY/);
    expect(['ok', 'missing', 'invalid', 'emulator']).toContain(res.body.credentials);
  });
});
