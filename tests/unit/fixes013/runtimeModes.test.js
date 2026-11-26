import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { refreshRuntimeModes, __resetRuntimeModes, runtimeModes } from '../../../api/_lib/runtimeModes.js';
import { paystackMode, paystackModeSource } from '../../../api/_lib/mode.js';

/**
 * 013Fixes / 33a — which Paystack mode is in force: the superadmin's setting
 * (config/mode), then the environment (PAYSTACK_MODE), then the safe default
 * (test). A failed read keeps the last good value, never jumps to live.
 */

const dbWith = (data, { fail = false } = {}) => {
  let reads = 0;
  return {
    reads: () => reads,
    doc: () => ({
      get: async () => {
        reads += 1;
        if (fail) throw new Error('unavailable');
        return { exists: data != null, data: () => data };
      },
    }),
  };
};

const saved = process.env.PAYSTACK_MODE;
beforeEach(() => { __resetRuntimeModes(); });
afterEach(() => { if (saved === undefined) delete process.env.PAYSTACK_MODE; else process.env.PAYSTACK_MODE = saved; });

describe('Paystack mode resolution', () => {
  it('the setting wins over the environment', async () => {
    process.env.PAYSTACK_MODE = 'live';
    await refreshRuntimeModes(dbWith({ payments: 'test' }));
    expect(paystackMode()).toBe('dev');
    expect(paystackModeSource()).toBe('setting');
    __resetRuntimeModes();
    process.env.PAYSTACK_MODE = 'test';
    await refreshRuntimeModes(dbWith({ payments: 'live' }));
    expect(paystackMode()).toBe('live');
  });

  it('no setting: the environment', async () => {
    process.env.PAYSTACK_MODE = 'live';
    await refreshRuntimeModes(dbWith(null));
    expect(paystackMode()).toBe('live');
    expect(paystackModeSource()).toBe('env');
  });

  it('neither (or a typo): test, the safe default', async () => {
    process.env.PAYSTACK_MODE = 'LIVEE';
    await refreshRuntimeModes(dbWith({ payments: 'banana' }));
    expect(paystackMode()).toBe('dev');
    delete process.env.PAYSTACK_MODE;
    expect(paystackMode()).toBe('dev');
  });

  it('cached 30 s: one read per isolate', async () => {
    const db = dbWith({ payments: 'live' });
    await refreshRuntimeModes(db, { now: 1_000 });
    await refreshRuntimeModes(db, { now: 20_000 });
    expect(db.reads()).toBe(1);
    await refreshRuntimeModes(db, { now: 32_000 });
    expect(db.reads()).toBe(2);
  });

  it('a failed read keeps the last good value; with none, the environment', async () => {
    process.env.PAYSTACK_MODE = 'test';
    await refreshRuntimeModes(dbWith({ payments: 'live' }), { now: 1_000 });
    await refreshRuntimeModes(dbWith(null, { fail: true }), { now: 40_000 });
    expect(paystackMode()).toBe('live');
    __resetRuntimeModes();
    await refreshRuntimeModes(dbWith(null, { fail: true }), { now: 1_000 });
    expect(runtimeModes()).toEqual({});
    expect(paystackMode()).toBe('dev');
  });
});
