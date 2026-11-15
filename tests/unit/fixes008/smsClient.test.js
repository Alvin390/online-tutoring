import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 008Fixes / 01 — the HashBack client: the request it makes, and errors
 * branched on HashBack's stable `code` (never its English text).
 */

const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
});

let sms;
let calls;
beforeEach(async () => {
  vi.resetModules();
  process.env.HASHBACK_API_KEY = 'hb_unit_only';
  delete process.env.SMS_DISABLED;
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url, init });
    return reply(201, { success: true, id: 'abc', to: '254712345678', status: 'sent', units: 1, cost: 0.35, balance: 412.6 });
  }));
  vi.doMock('../../../api/_lib/firebaseAdmin.js', () => ({ getDb: () => ({ doc: () => ({ set: async () => {} }) }) }));
  sms = await import('../../../api/_lib/sms.js');
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.HASHBACK_API_KEY; });

describe('sending', () => {
  it('POSTs to /sms/send with the Bearer key and returns id, units, cost, balance', async () => {
    const out = await sms.sendSms({ to: '+254712345678', message: 'Your code is 123456.' });
    expect(out).toEqual({ id: 'abc', units: 1, cost: 0.35, balance: 412.6, status: 'sent', senderId: null });
    expect(calls[0].url).toBe('https://api.hashback.co.ke/sms/send');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe('Bearer hb_unit_only');
    expect(JSON.parse(calls[0].init.body)).toEqual({ to: '+254712345678', message: 'Your code is 123456.' });
  });

  it('no key, or SMS_DISABLED: sms_unavailable, and nothing leaves', async () => {
    process.env.HASHBACK_API_KEY = '';
    await expect(sms.sendSms({ to: '+254712345678', message: 'x' })).rejects.toMatchObject({ code: 'sms_unavailable' });
    process.env.HASHBACK_API_KEY = 'hb_unit_only';
    process.env.SMS_DISABLED = 'true';
    await expect(sms.sendSms({ to: '+254712345678', message: 'x' })).rejects.toMatchObject({ code: 'sms_unavailable' });
    expect(calls).toHaveLength(0);
    expect(sms.smsAvailable()).toBe(false);
  });
});

describe('where requests go (008Fixes / 08)', () => {
  it('a local fake on this machine may stand in; any other address is ignored', async () => {
    process.env.HASHBACK_BASE_URL = 'http://127.0.0.1:8790/sms';
    await sms.sendSms({ to: '0712345678', message: 'x' });
    expect(calls.at(-1).url).toBe('http://127.0.0.1:8790/sms/send');
    process.env.HASHBACK_BASE_URL = 'https://elsewhere.example/sms';
    await sms.sendSms({ to: '0712345678', message: 'x' });
    expect(calls.at(-1).url).toBe('https://api.hashback.co.ke/sms/send');
    delete process.env.HASHBACK_BASE_URL;
  });
});

describe('errors', () => {
  it('maps HashBack codes, with Retry-After when rate limited', async () => {
    fetch.mockResolvedValueOnce(reply(402, { success: false, code: 'INSUFFICIENT_FUNDS', message: 'Top up' }));
    await expect(sms.sendSms({ to: '0712345678', message: 'x' })).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS', status: 402 });
    fetch.mockResolvedValueOnce(reply(429, { success: false, code: 'RATE_LIMITED', message: 'slow down' }, { 'retry-after': '12' }));
    await expect(sms.sendSms({ to: '0712345678', message: 'x' })).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfter: 12 });
  });

  it('a non-JSON answer or a dropped connection is an error, not a success', async () => {
    fetch.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(sms.sendSms({ to: '0712345678', message: 'x' })).rejects.toMatchObject({ code: 'http_502' });
    fetch.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(sms.sendSms({ to: '0712345678', message: 'x' })).rejects.toMatchObject({ code: 'network_error' });
  });
});
