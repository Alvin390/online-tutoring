import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 007Fixes / 02: the public bootstrap on a slow network.
 *
 * On 10 Nov the home page's /api/public/bootstrap timed out at 15 s on a
 * student's phone. Owner (2026-11-11): one quiet retry, then the last good copy
 * saved on that phone. Public data only (flags, active sessions): never a
 * token. Storage that throws (Sentry 1-D) must never break the page.
 */

const KEY = 'ot.bootstrap.v1';
const DAY = 24 * 60 * 60 * 1000;
const LIVE = {
  flags: { 'registration.requireApproval': true },
  sessions: [{ slug: 'saturday', name: 'Saturday', active: true }],
  payments: { mpesa: false },
};
const timeout = () => Object.assign(new Error('timed out'), { name: 'ApiError', code: 'timeout' });

let apiGet;
async function load() {
  vi.resetModules();
  apiGet = vi.fn();
  vi.doMock('@services/api/client', () => ({ apiGet, apiPost: vi.fn() }));
  return import('@services/api/public');
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.doUnmock('@services/api/client'); vi.restoreAllMocks(); localStorage.clear(); });

describe('getPublicBootstrap', () => {
  it('asks with one quiet retry', async () => {
    const pub = await load();
    apiGet.mockResolvedValue(LIVE);
    await pub.getPublicBootstrap();
    expect(apiGet).toHaveBeenCalledWith('/api/public/bootstrap', expect.objectContaining({ retry: 1 }));
  });

  it('saves flags and sessions (and nothing else) after a good answer', async () => {
    const pub = await load();
    apiGet.mockResolvedValue({ ...LIVE, secretish: 'x' });
    await pub.getPublicBootstrap();
    const saved = JSON.parse(localStorage.getItem(KEY));
    expect(Object.keys(saved).sort()).toEqual(['flags', 'savedAt', 'sessions']);
    expect(saved.sessions[0].slug).toBe('saturday');
    expect(saved.flags['registration.requireApproval']).toBe(true);
  });

  it('uses the saved copy when the network fails, marked fromCache', async () => {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now() - DAY, ...LIVE }));
    const pub = await load();
    apiGet.mockRejectedValue(timeout());
    const data = await pub.getPublicBootstrap();
    expect(data.fromCache).toBe(true);
    expect(data.sessions.map((s) => s.slug)).toEqual(['saturday']);
    expect(data.flags['registration.requireApproval']).toBe(true);
  });

  it('ignores a copy older than 14 days, and fails as before', async () => {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now() - 15 * DAY, ...LIVE }));
    const pub = await load();
    apiGet.mockRejectedValue(timeout());
    await expect(pub.getPublicBootstrap()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('a broken copy is ignored', async () => {
    localStorage.setItem(KEY, '{not json');
    const pub = await load();
    apiGet.mockRejectedValue(timeout());
    await expect(pub.getPublicBootstrap()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('storage that throws never breaks it: a good answer still returns, a failure still rejects', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const pub = await load();
    apiGet.mockResolvedValueOnce(LIVE);
    await expect(pub.getPublicBootstrap()).resolves.toMatchObject({ sessions: LIVE.sessions });
    apiGet.mockRejectedValue(timeout());
    await expect(pub.getPublicBootstrap({ force: true })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('a failure is not kept in memory: the next call asks the network again', async () => {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), ...LIVE }));
    const pub = await load();
    apiGet.mockRejectedValueOnce(timeout()).mockResolvedValue({ ...LIVE, sessions: [{ slug: 'sunday' }] });
    expect((await pub.getPublicBootstrap()).fromCache).toBe(true);
    const fresh = await pub.getPublicBootstrap();
    expect(fresh.fromCache).toBeUndefined();
    expect(fresh.sessions[0].slug).toBe('sunday');
  });
});
