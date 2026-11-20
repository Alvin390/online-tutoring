import { describe, it, expect } from 'vitest';
import * as server from '../../../api/_lib/plans.js';
import * as client from '@shared/constants/plans';

/**
 * 013Fixes / 00 — the plan map (what each plan includes).
 *
 * PARITY: api/_lib/plans.js and src/shared/constants/plans.js are two copies of
 * one map (the Worker and the browser bundle each need one). They must agree
 * exactly, or a screen offers what the server refuses.
 */

describe('the plan map is identical on both sides', () => {
  it('exports the same plans, keys and constants', () => {
    expect(client.PLAN_IDS).toEqual(server.PLAN_IDS);
    expect(client.FEATURE_KEYS).toEqual(server.FEATURE_KEYS);
    expect(client.LIMIT_KEYS).toEqual(server.LIMIT_KEYS);
    expect(client.TRIAL_SMS_UNITS).toBe(server.TRIAL_SMS_UNITS);
    expect(client.DEFAULT_PLANS).toEqual(server.DEFAULT_PLANS);
    expect(client.NO_PLAN).toEqual(server.NO_PLAN);
  });

  it('merges overrides and names plans the same way', () => {
    const over = { silver: { features: { calendar: false }, limits: { logins: 6 } } };
    expect(client.mergePlans(over)).toEqual(server.mergePlans(over));
    for (const key of server.FEATURE_KEYS) {
      expect(client.lowestPlanWith(key)).toBe(server.lowestPlanWith(key));
    }
  });
});

describe('every plan spells out every feature and limit', () => {
  it('has a boolean for each feature and a whole number for each limit', () => {
    for (const id of server.PLAN_IDS) {
      const plan = server.DEFAULT_PLANS[id];
      expect(Object.keys(plan.features).sort()).toEqual([...server.FEATURE_KEYS].sort());
      for (const key of server.FEATURE_KEYS) expect(typeof plan.features[key]).toBe('boolean');
      expect(Object.keys(plan.limits).sort()).toEqual([...server.LIMIT_KEYS].sort());
      for (const key of server.LIMIT_KEYS) expect(Number.isInteger(plan.limits[key])).toBe(true);
    }
  });

  it('is frozen, so no caller can change a plan in place', () => {
    expect(() => { server.DEFAULT_PLANS.bronze.features.fees = true; }).toThrow();
    expect(server.DEFAULT_PLANS.bronze.features.fees).toBe(false);
  });
});

describe('plans inherit upwards', () => {
  it('gives Silver everything Bronze has, and Gold everything Silver has', () => {
    const { bronze, silver, gold } = server.DEFAULT_PLANS;
    for (const key of server.FEATURE_KEYS) {
      if (bronze.features[key]) expect(silver.features[key], key).toBe(true);
      if (silver.features[key]) expect(gold.features[key], key).toBe(true);
    }
    for (const key of server.LIMIT_KEYS) {
      expect(silver.limits[key]).toBeGreaterThanOrEqual(bronze.limits[key]);
      expect(gold.limits[key]).toBeGreaterThanOrEqual(silver.limits[key]);
    }
  });
});

describe('each feature starts at the plan the owner\'s matrix gives it (so far)', () => {
  // Phase 00 copied the gates as they were on 2026-11-19; each later phase
  // moves the features it is about, and this table moves with it.
  const TODAY = {
    sessions: 'bronze', // api/sessions/manage.js tier: 'bronze'
    calendar: 'bronze', // 02: every plan (was Silver)
    fees: 'silver', // fees/config + annotate
    feePayments: 'silver', // fees/post; payment on receipt approval (bulk UI)
    feeBlocks: 'silver', // bulk + scheduled fee blocks
    invoices: 'silver', // fees/generateInvoices
    bulkSms: 'silver', // messages/sms
    targetedSms: 'gold', // choosing SMS recipients
    whatsappOneToOne: 'bronze', // 02: every plan (was Silver, the whole Messages tab)
    whatsappCampaigns: null, // 06: retired — on no plan
    mpesaStk: 'gold', // mpesaAvailability
    notes: 'bronze',
    basicBlocks: 'bronze',
    scheduledBlocks: 'silver', // 03: Silver and up (was every plan)
  };

  it('starts every feature at the plan that had it', () => {
    expect(Object.keys(TODAY).sort()).toEqual([...server.FEATURE_KEYS].sort());
    for (const [key, plan] of Object.entries(TODAY)) expect(server.lowestPlanWith(key), key).toBe(plan);
  });

  it('carries the owner\'s limits (spec §2, owner answers 2026-11-19)', () => {
    expect(server.DEFAULT_PLANS.bronze.limits).toEqual({ activeStudents: 100, sessions: 2, logins: 2, smsUnits: 0 });
    expect(server.DEFAULT_PLANS.silver.limits).toEqual({ activeStudents: 300, sessions: 5, logins: 5, smsUnits: 1000 });
    expect(server.DEFAULT_PLANS.gold.limits).toEqual({ activeStudents: 500, sessions: 10, logins: 10, smsUnits: 3000 });
    expect(server.TRIAL_SMS_UNITS).toBe(100);
  });
});

describe('mergePlans takes only well-formed overrides', () => {
  it('applies a boolean feature and a whole-number limit', () => {
    const merged = server.mergePlans({ bronze: { features: { fees: true }, limits: { logins: 3 } } });
    expect(merged.bronze.features.fees).toBe(true);
    expect(merged.bronze.limits.logins).toBe(3);
    expect(merged.silver).toEqual(server.DEFAULT_PLANS.silver);
  });

  it('ignores unknown plans, unknown keys, wrong types and bad numbers', () => {
    const merged = server.mergePlans({
      platinum: { features: { fees: true } },
      bronze: {
        features: { fees: 'yes', madeUp: true, mpesaStk: 1 },
        limits: { logins: -1, sessions: 2.5, activeStudents: '500', madeUp: 4, smsUnits: 5_000_000 },
      },
    });
    expect(merged).toEqual(server.mergePlans(null));
    expect(merged.bronze).toEqual(server.DEFAULT_PLANS.bronze);
    expect(merged).not.toHaveProperty('platinum');
  });

  it('survives a missing or broken document', () => {
    for (const bad of [null, undefined, 'x', 3, [], { bronze: 'x' }]) {
      expect(server.mergePlans(bad)).toEqual(server.mergePlans(null));
    }
  });
});

describe('planFor', () => {
  it('gives no plan for a missing or unknown tier', () => {
    for (const tier of [null, undefined, '', 'platinum', 'GOLD']) {
      const plan = server.planFor(tier);
      expect(Object.values(plan.features).every((v) => v === false)).toBe(true);
      expect(Object.values(plan.limits).every((v) => v === 0)).toBe(true);
    }
  });

  it('returns the merged plan for a known tier', () => {
    const plans = server.mergePlans({ silver: { features: { targetedSms: true } } });
    expect(server.planFor('silver', plans).features.targetedSms).toBe(true);
    expect(server.planFor('silver').features.targetedSms).toBe(false);
  });
});
