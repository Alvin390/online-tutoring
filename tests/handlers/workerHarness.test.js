import { describe, it, expect, beforeAll } from 'vitest';
import { pinEnv, installFetchGuard, call, externalCalls } from './_worker.js';

/**
 * Self-test for the Worker harness — Phase 13 / 01 D2.
 *
 * If these fail, every Worker-level test built on the harness is suspect.
 */

beforeAll(() => {
  pinEnv({ PERF_TIMING: '1' });
  installFetchGuard();
});

describe('Worker harness', () => {
  it('routes /api/health through the real Worker entry', async () => {
    const res = await call('/api/health', { method: 'GET' });
    expect(res.status).toBe(200);
    // Applied by worker/index.js, not by the handler — proves the request
    // really went through the entry point.
    expect(res.headers.get('strict-transport-security')).toMatch(/max-age/);
  });

  it('returns a clean 404 for an unknown route', async () => {
    const res = await call('/api/does-not-exist', { method: 'GET' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('blocks any external host that has no fake', async () => {
    await expect(fetch('https://example.com/should-not-be-reached')).rejects.toThrow(/blocked external call/);
    expect(externalCalls.at(-1).url).toBe('https://example.com/should-not-be-reached');
  });

  it('emits Server-Timing with total and Firestore subrequest count when PERF_TIMING=1', async () => {
    const res = await call('/api/student/checkin', {
      body: { session: 'morning', phone: '+254700000999' },
    });
    const timing = res.headers.get('server-timing');
    expect(timing).toMatch(/total;dur=\d+(\.\d+)?/);
    expect(timing).toMatch(/subreq;desc="\d+"/);
  });

  it('omits Server-Timing when PERF_TIMING is not set', async () => {
    delete process.env.PERF_TIMING;
    const res = await call('/api/student/checkin', {
      body: { session: 'morning', phone: '+254700000998' },
    });
    expect(res.headers.get('server-timing')).toBeNull();
    process.env.PERF_TIMING = '1';
  });
});
