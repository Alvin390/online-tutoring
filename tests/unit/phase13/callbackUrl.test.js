import { describe, it, expect } from 'vitest';
import { buildCallbackUrl } from '../../../api/_lib/daraja.js';

// Phase 13 / 04 D1 — the STK CallBackURL rules, checked before any STK push.
describe('buildCallbackUrl', () => {
  const secret = 'Ab3dEf6hIj9kLm2nOp5qRs';

  it('builds the route the Worker matches', () => {
    expect(buildCallbackUrl('https://online-tutoring.alvinkariuki07.workers.dev', secret))
      .toBe(`https://online-tutoring.alvinkariuki07.workers.dev/api/daraja/callback/${secret}`);
    expect(buildCallbackUrl('https://x.example/', secret)).toBe(`https://x.example/api/daraja/callback/${secret}`);
  });

  it('refuses an empty or missing secret (the …/callback/ 404 bug)', () => {
    expect(() => buildCallbackUrl('https://x.example', '')).toThrow(/secret/);
    expect(() => buildCallbackUrl('https://x.example', undefined)).toThrow(/secret/);
    expect(() => buildCallbackUrl('https://x.example', 'short')).toThrow(/secret/);
  });

  it('refuses plain HTTP', () => {
    expect(() => buildCallbackUrl('http://x.example', secret)).toThrow(/HTTPS/);
    expect(() => buildCallbackUrl(undefined, secret)).toThrow(/HTTPS/);
  });

  it.each(['https://mpesa-pay.example', 'https://x.example/M-PESA', 'https://SafariCom.example'])(
    'refuses words Safaricom filters: %s',
    (base) => expect(() => buildCallbackUrl(base, secret)).toThrow(/must not contain/)
  );

  it('the route itself never contains a filtered word', () => {
    expect(buildCallbackUrl('https://x.example', secret)).not.toMatch(/m-?pesa|safaricom/i);
  });
});
