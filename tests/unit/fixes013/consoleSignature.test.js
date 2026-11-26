import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  signConsoleRequest, verifyConsoleRequest, signingString, TIMESTAMP_HEADER, SIGNATURE_HEADER,
} from '../../../api/_lib/consoleSignature.js';

/**
 * 013Fixes / 37-38 — the console's signing (used by the school to verify and
 * by the console to sign): the exact bytes, checked against node:crypto
 * directly, and the refusals.
 */

const SECRET = 'unit-console-secret';
const REQ = { method: 'GET', host: 'School.Example', path: '/api/platform/status', timestamp: 1_764_140_000_000 };

describe('console signatures', () => {
  it('signs "METHOD\\nhost\\npath\\ntimestamp" with HMAC-SHA256 (hex)', () => {
    expect(signingString(REQ)).toBe('GET\nschool.example\n/api/platform/status\n1764140000000');
    const headers = signConsoleRequest(SECRET, REQ);
    const expected = createHmac('sha256', SECRET).update('GET\nschool.example\n/api/platform/status\n1764140000000').digest('hex');
    expect(headers).toEqual({ [TIMESTAMP_HEADER]: '1764140000000', [SIGNATURE_HEADER]: expected });
  });

  it('verifies its own signature; refuses another secret, host, path or method', () => {
    const h = signConsoleRequest(SECRET, REQ);
    const v = (over = {}, secret = SECRET) => verifyConsoleRequest(secret, {
      ...REQ, timestamp: h[TIMESTAMP_HEADER], signature: h[SIGNATURE_HEADER], now: REQ.timestamp, ...over,
    });
    expect(v()).toEqual({ ok: true });
    expect(v({}, 'other')).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(v({ host: 'other.example' })).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(v({ path: '/api/x' })).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(v({ method: 'POST' })).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(v({ signature: 'not-hex' })).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a missing header, and anything more than 5 minutes off', () => {
    const h = signConsoleRequest(SECRET, REQ);
    const at = (now) => verifyConsoleRequest(SECRET, { ...REQ, timestamp: h[TIMESTAMP_HEADER], signature: h[SIGNATURE_HEADER], now });
    expect(verifyConsoleRequest(SECRET, { ...REQ, timestamp: null, signature: null })).toMatchObject({ reason: 'missing' });
    expect(at(REQ.timestamp + 5 * 60_000)).toEqual({ ok: true });
    expect(at(REQ.timestamp + 5 * 60_000 + 1)).toMatchObject({ reason: 'stale' });
    expect(at(REQ.timestamp - 5 * 60_000 - 1)).toMatchObject({ reason: 'stale' });
  });
});
