import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiPost, apiGet, ApiError } from '@services/api/client';

/**
 * 002Fixes / 01 — every API error says which endpoint failed, and a 429 carries
 * the server's Retry-After so a refused student can be told how long to wait.
 */

const respond = (status, body, headers = {}) => vi.fn().mockResolvedValue(
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
);

afterEach(() => vi.unstubAllGlobals());

describe('ApiError carries the endpoint', () => {
  it('a server refusal names the path (without its query string) and keeps code and status', async () => {
    vi.stubGlobal('fetch', respond(400, { error: { code: 'validation_failed', message: 'phone: bad' } }));
    const err = await apiPost('/api/student/checkin?x=1', { session: 'evening', phone: '' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ path: '/api/student/checkin', code: 'validation_failed', status: 400 });
    expect(err.retryAfter).toBeUndefined();
  });

  it('a network failure and a timeout name the path too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const net = await apiPost('/api/class/link', {}).catch((e) => e);
    expect(net).toMatchObject({ code: 'network_error', path: '/api/class/link' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    const slow = await apiGet('/api/public/bootstrap').catch((e) => e);
    expect(slow).toMatchObject({ code: 'timeout', path: '/api/public/bootstrap' });
  });
});

describe('Retry-After on a 429', () => {
  it('is read as whole seconds', async () => {
    vi.stubGlobal('fetch', respond(429, { error: { code: 'rate_limited', message: 'Too many requests.' } }, { 'Retry-After': '1800' }));
    const err = await apiPost('/api/student/checkin', {}).catch((e) => e);
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', retryAfter: 1800 });
  });

  it('is undefined when the header is missing or not a number', async () => {
    vi.stubGlobal('fetch', respond(429, { error: { code: 'rate_limited' } }));
    expect((await apiPost('/api/student/checkin', {}).catch((e) => e)).retryAfter).toBeUndefined();
    vi.stubGlobal('fetch', respond(429, { error: { code: 'rate_limited' } }, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }));
    expect((await apiGet('/api/student/checkin').catch((e) => e)).retryAfter).toBeUndefined();
  });

  it('success is unchanged', async () => {
    vi.stubGlobal('fetch', respond(200, { exists: true, student: { studentName: 'A' } }));
    await expect(apiPost('/api/student/checkin', {})).resolves.toEqual({ exists: true, student: { studentName: 'A' } });
  });
});
