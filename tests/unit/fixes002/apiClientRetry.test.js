import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiPost, apiGet } from '@services/api/client';

/**
 * 002Fixes / 04 — an OK response with no readable body is a network error
 * (Sentry ONLINE-TUTORING-1-6), and safe reads retry once after a timeout or a
 * dropped connection — never after an answer from the server.
 */

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('an OK response must have a body', () => {
  it('a 200 whose body is not JSON (a dropped connection, a portal page) is a network error, not null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>portal</html>', { status: 200 })));
    const err = await apiPost('/api/student/checkin', {}).catch((e) => e);
    expect(err).toMatchObject({ name: 'ApiError', code: 'network_error', path: '/api/student/checkin' });
  });

  it('a body that fails mid-read is a network error', async () => {
    const broken = new Response('{"exists":', { status: 200, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(broken));
    await expect(apiGet('/api/public/bootstrap')).rejects.toMatchObject({ code: 'network_error' });
  });

  it('a 204 is an empty object', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiPost('/api/x', {})).resolves.toEqual({});
  });
});

describe('one bounded retry, opt-in', () => {
  it('timeout then success → resolves, after exactly two fetches', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(aborted()).mockResolvedValueOnce(json(200, { exists: true }));
    vi.stubGlobal('fetch', fetch);
    const p = apiPost('/api/student/checkin', {}, { retry: 1 });
    await vi.advanceTimersByTimeAsync(800);
    await expect(p).resolves.toEqual({ exists: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('two network failures → the error, after exactly two fetches', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    const p = apiPost('/api/class/link', {}, { retry: 1 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(800);
    expect(await p).toMatchObject({ code: 'network_error' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a 429 is never retried — that would only deepen the lockout', async () => {
    const fetch = vi.fn().mockResolvedValue(json(429, { error: { code: 'rate_limited', message: 'Too many' } }, { 'Retry-After': '600' }));
    vi.stubGlobal('fetch', fetch);
    await expect(apiPost('/api/student/checkin', {}, { retry: 1 })).rejects.toMatchObject({ status: 429, retryAfter: 600 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a 400 is never retried', async () => {
    const fetch = vi.fn().mockResolvedValue(json(400, { error: { code: 'validation_failed', message: 'bad' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(apiPost('/api/student/checkin', {}, { retry: 1 })).rejects.toMatchObject({ status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('without opting in there is exactly one attempt', async () => {
    const fetch = vi.fn().mockRejectedValue(aborted());
    vi.stubGlobal('fetch', fetch);
    await expect(apiPost('/api/student/register', {})).rejects.toMatchObject({ code: 'timeout' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a caller who cancels is not retried', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn().mockRejectedValue(aborted());
    vi.stubGlobal('fetch', fetch);
    await expect(apiPost('/api/reports/attachment', {}, { retry: 1, signal: controller.signal })).rejects.toMatchObject({ code: 'timeout' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('which calls opt in', () => {
  it('check-in and the class link retry once; registration and receipts never', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    const student = await import('@services/api/student');
    const settle = async (p) => { const r = p.catch(() => {}); await vi.advanceTimersByTimeAsync(800); await r; };

    await settle(student.checkinStudent('evening', '+254711000009'));
    expect(fetch).toHaveBeenCalledTimes(2);
    await settle(student.getClassLink('evening', '+254711000009'));
    expect(fetch).toHaveBeenCalledTimes(4);
    await settle(student.submitReceipt('evening', '+254711000009', 'QAB123XYZ9'));
    expect(fetch).toHaveBeenCalledTimes(5);
    await settle(student.resubmitRegistration('evening', '+254711000009', {}));
    expect(fetch).toHaveBeenCalledTimes(6);
  });
});
