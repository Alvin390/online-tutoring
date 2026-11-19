import { describe, it, expect, beforeEach } from 'vitest';
import {
  schoolPlan, requireFeature, hasFeature, resolvePlan, invalidatePlanCache,
} from '../../../api/_lib/schoolPlan.js';

/**
 * 013Fixes / 00 — the school's plan, read from `subscription/current` (with the
 * superadmin's `config/plans` on top), never from the login's claims.
 */

function fakeDb(docs, { fail = false } = {}) {
  const reads = { count: 0 };
  return {
    reads,
    doc(path) {
      return {
        async get() {
          reads.count += 1;
          if (fail) throw new Error('UNAVAILABLE');
          const data = docs[path];
          return { exists: data !== undefined, data: () => data };
        },
      };
    },
  };
}

const teacher = (claims = {}) => ({ uid: 't1', role: 'teacher', tier: null, tierRank: 0, ...claims });

beforeEach(() => invalidatePlanCache());

describe('the plan comes from the tier, whatever the billing status', () => {
  for (const status of ['trialing', 'active', 'past_due', 'grace', 'locked', 'expired', 'cancelled']) {
    it(`a Silver school that is ${status} keeps Silver's features`, async () => {
      const plan = await schoolPlan(fakeDb({ 'subscription/current': { tier: 'silver', status } }));
      expect(plan.tier).toBe('silver');
      expect(plan.status).toBe(status);
      expect(plan.features.fees).toBe(true);
      expect(plan.features.targetedSms).toBe(false);
      expect(plan.limits.logins).toBe(5);
    });
  }

  it('marks a comp plan', async () => {
    const plan = await schoolPlan(fakeDb({ 'subscription/current': { tier: 'gold', status: 'active', grantedBySuperadmin: true } }));
    expect(plan.comp).toBe(true);
    expect(plan.features.targetedSms).toBe(true);
  });

  it('applies the superadmin\'s plan settings', async () => {
    const plan = await schoolPlan(fakeDb({
      'subscription/current': { tier: 'bronze', status: 'active' },
      'config/plans': { bronze: { features: { calendar: true }, limits: { logins: 4 } } },
    }));
    expect(plan.features.calendar).toBe(true);
    expect(plan.limits.logins).toBe(4);
  });
});

describe('no subscription, and a failed read', () => {
  it('a missing subscription is no plan: every gated feature refused', async () => {
    const plan = await schoolPlan(fakeDb({}));
    expect(plan.tier).toBeNull();
    expect(Object.values(plan.features).every((v) => v === false)).toBe(true);
  });

  it('an unknown tier is no plan', async () => {
    const plan = await schoolPlan(fakeDb({ 'subscription/current': { tier: 'platinum', status: 'active' } }));
    expect(plan.tier).toBeNull();
    expect(plan.features.sessions).toBe(false);
  });

  it('a failed read throws 503 and is NOT cached as "no plan"', async () => {
    await expect(schoolPlan(fakeDb({}, { fail: true }))).rejects.toMatchObject({ status: 503, code: 'plan_unavailable' });
    const plan = await schoolPlan(fakeDb({ 'subscription/current': { tier: 'gold', status: 'active' } }));
    expect(plan.tier).toBe('gold');
  });
});

describe('the cache', () => {
  it('reads once a minute per isolate, and a write clears it', async () => {
    const db = fakeDb({ 'subscription/current': { tier: 'silver', status: 'active' } });
    await schoolPlan(db);
    await schoolPlan(db);
    expect(db.reads.count).toBe(2); // subscription + config/plans, once

    invalidatePlanCache();
    await schoolPlan(db);
    expect(db.reads.count).toBe(4);
  });
});

describe('requireFeature and hasFeature', () => {
  it('ignores the login\'s claims: a Bronze school with a crafted Gold claim is refused', async () => {
    const db = fakeDb({ 'subscription/current': { tier: 'bronze', status: 'active' } });
    const crafted = teacher({ tier: 'gold', tierRank: 3 });
    await expect(requireFeature(crafted, 'fees', db)).rejects.toMatchObject({ status: 403, code: 'tier_required' });
    expect(await hasFeature(crafted, 'targetedSms', db)).toBe(false);
  });

  it('a Gold school with a stale Bronze claim is allowed', async () => {
    const db = fakeDb({ 'subscription/current': { tier: 'gold', status: 'active' } });
    const stale = teacher({ tier: 'bronze', tierRank: 1 });
    await expect(requireFeature(stale, 'targetedSms', db)).resolves.toBe(stale);
    expect(await hasFeature(stale, 'mpesaStk', db)).toBe(true);
  });

  it('names the cheapest plan that has the feature', async () => {
    const db = fakeDb({ 'subscription/current': { tier: 'bronze', status: 'active' } });
    await expect(requireFeature(teacher(), 'targetedSms', db)).rejects.toThrow('This feature requires the gold plan.');
  });

  it('lets the superadmin use anything, without reading the plan', async () => {
    const db = fakeDb({});
    const admin = { uid: 'a', role: 'superadmin' };
    await expect(requireFeature(admin, 'mpesaStk', db)).resolves.toBe(admin);
    expect(await hasFeature(admin, 'fees', db)).toBe(true);
    expect(db.reads.count).toBe(0);
  });
});

describe('resolvePlan (pure)', () => {
  it('works from a document already read (the money paths)', () => {
    expect(resolvePlan({ tier: 'gold', status: 'locked' }, null).features.mpesaStk).toBe(true);
    expect(resolvePlan(null, null).features.mpesaStk).toBe(false);
    expect(resolvePlan({ tier: 'gold' }, { gold: { features: { mpesaStk: false } } }).features.mpesaStk).toBe(false);
  });
});
