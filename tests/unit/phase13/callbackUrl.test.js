import { describe, it, expect, afterEach } from 'vitest';
import { buildCallbackUrl, callbackBaseUrl, isUnreachableCallback } from '../../../api/_lib/daraja.js';

/** The operator-facing reason travels in `cause`; students get a plain 503. */
function failure(fn) {
  try {
    fn();
  } catch (err) {
    return { status: err.status, code: err.code, reason: err.cause?.message ?? err.message };
  }
  return null;
}

describe('buildCallbackUrl', () => {
  const secret = 'Ab3dEf6hIj9kLm2nOp5qRs';

  it('builds the callback path from the base URL and secret', () => {
    expect(buildCallbackUrl('https://online-tutoring.alvinkariuki07.workers.dev', secret, { mode: 'live' }))
      .toBe(`https://online-tutoring.alvinkariuki07.workers.dev/api/daraja/callback/${secret}`);
    expect(buildCallbackUrl('https://x.example/', secret)).toBe(`https://x.example/api/daraja/callback/${secret}`);
  });

  it('refuses a missing or weak secret', () => {
    for (const bad of ['', undefined, 'short']) {
      expect(failure(() => buildCallbackUrl('https://x.example', bad))?.reason).toMatch(/secret/);
    }
  });

  it('LIVE refuses a non-HTTPS URL, as a clear 503 (not a bare 500)', () => {
    const f = failure(() => buildCallbackUrl('http://x.example', secret, { mode: 'live' }));
    expect(f).toMatchObject({ status: 503, code: 'payments_misconfigured' });
    expect(f.reason).toMatch(/HTTPS in live mode/);
  });

  it('SANDBOX allows http://localhost, so local STK prompts work as before Phase 13 / 04', () => {
    expect(buildCallbackUrl('http://localhost:5173', secret, { mode: 'dev' }))
      .toBe(`http://localhost:5173/api/daraja/callback/${secret}`);
  });

  it('refuses a missing base URL in any mode', () => {
    for (const mode of ['dev', 'live']) {
      expect(failure(() => buildCallbackUrl(undefined, secret, { mode }))?.reason).toMatch(/no base URL/);
    }
  });

  it.each(['https://mpesa.example', 'https://my-m-pesa.example', 'https://SAFARICOM-x.example'])(
    'refuses %s',
    (base) => expect(failure(() => buildCallbackUrl(base, secret))?.reason).toMatch(/must not contain/)
  );

  it('the normal production URL contains none of the forbidden words', () => {
    expect(buildCallbackUrl('https://x.example', secret)).not.toMatch(/m-?pesa|safaricom/i);
  });
});

describe('callbackBaseUrl / isUnreachableCallback', () => {
  const saved = { a: process.env.DARAJA_CALLBACK_BASE_URL, b: process.env.PUBLIC_BASE_URL };
  afterEach(() => {
    process.env.DARAJA_CALLBACK_BASE_URL = saved.a ?? '';
    process.env.PUBLIC_BASE_URL = saved.b ?? '';
    if (saved.a === undefined) delete process.env.DARAJA_CALLBACK_BASE_URL;
    if (saved.b === undefined) delete process.env.PUBLIC_BASE_URL;
  });

  it('a tunnel URL (DARAJA_CALLBACK_BASE_URL) wins over PUBLIC_BASE_URL', () => {
    process.env.PUBLIC_BASE_URL = 'http://localhost:5173';
    process.env.DARAJA_CALLBACK_BASE_URL = 'https://abc.trycloudflare.com';
    expect(callbackBaseUrl()).toBe('https://abc.trycloudflare.com');
    delete process.env.DARAJA_CALLBACK_BASE_URL;
    expect(callbackBaseUrl()).toBe('http://localhost:5173');
  });

  it('flags URLs Safaricom cannot reach', () => {
    expect(isUnreachableCallback('http://localhost:5173/api/daraja/callback/x')).toBe(true);
    expect(isUnreachableCallback('https://127.0.0.1/api/daraja/callback/x')).toBe(true);
    expect(isUnreachableCallback('https://abc.trycloudflare.com/api/daraja/callback/x')).toBe(false);
  });
});
