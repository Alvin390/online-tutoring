import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 013Fixes / 03 — the scheduled-block sweep never acts on a guess: when the
 * school's plan can't be read, it neither applies nor cancels anything this
 * run; and when nothing is waiting it doesn't read the plan at all.
 */

const state = vi.hoisted(() => ({ waiting: true, planError: null, plan: null }));
const lib = vi.hoisted(() => ({ applyDueSchedules: vi.fn(), cancelWaitingSchedules: vi.fn() }));
const planMod = vi.hoisted(() => ({ schoolPlan: vi.fn() }));

vi.mock('../../../api/_lib/firebaseAdmin.js', () => ({
  getDb: () => ({
    collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: !state.waiting }) }) }) }),
  }),
}));
vi.mock('../../../api/_lib/scheduledBlocks.js', () => lib);
vi.mock('../../../api/_lib/schoolPlan.js', () => planMod);
vi.mock('../../../api/_lib/audit.js', () => ({ tryWriteAudit: vi.fn() }));

const { default: sweep } = await import('../../../api/cron/scheduledBlocksSweep.js');

function run() {
  const out = { status: null, body: null };
  const res = {
    setHeader() {},
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
  };
  return sweep({ method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }, res).then(() => out);
}

beforeEach(() => {
  process.env.CRON_SECRET = process.env.CRON_SECRET || 'unit-cron-secret';
  state.waiting = true;
  lib.applyDueSchedules.mockReset().mockResolvedValue({ schedules: 0 });
  lib.cancelWaitingSchedules.mockReset().mockResolvedValue([]);
  planMod.schoolPlan.mockReset();
});

describe('the sweep and the school plan', () => {
  it('a failed plan read: nothing applied, nothing cancelled, a quiet 200', async () => {
    planMod.schoolPlan.mockRejectedValue(Object.assign(new Error('UNAVAILABLE'), { status: 503, code: 'plan_unavailable' }));
    const out = await run();
    expect(out).toMatchObject({ status: 200, body: { ok: true, skipped: 'plan_unavailable' } });
    expect(lib.applyDueSchedules).not.toHaveBeenCalled();
    expect(lib.cancelWaitingSchedules).not.toHaveBeenCalled();
  });

  it('nothing waiting: the plan is not read', async () => {
    state.waiting = false;
    const out = await run();
    expect(out.status).toBe(200);
    expect(planMod.schoolPlan).not.toHaveBeenCalled();
    expect(lib.applyDueSchedules).not.toHaveBeenCalled();
  });

  it('a plan without scheduled blocks cancels, and never applies', async () => {
    planMod.schoolPlan.mockResolvedValue({ tier: 'bronze', features: { scheduledBlocks: false } });
    lib.cancelWaitingSchedules.mockResolvedValue(['a', 'b']);
    const out = await run();
    expect(out.body.cancelledForPlan).toBe(2);
    expect(lib.cancelWaitingSchedules).toHaveBeenCalledWith(expect.objectContaining({ because: 'plan' }));
    expect(lib.applyDueSchedules).not.toHaveBeenCalled();
  });

  it('a plan with scheduled blocks applies, and never cancels', async () => {
    planMod.schoolPlan.mockResolvedValue({ tier: 'silver', features: { scheduledBlocks: true } });
    await run();
    expect(lib.applyDueSchedules).toHaveBeenCalled();
    expect(lib.cancelWaitingSchedules).not.toHaveBeenCalled();
  });
});
