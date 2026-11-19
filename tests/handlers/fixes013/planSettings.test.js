import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, seedPlan,
} from '../_worker.js';

/**
 * 013Fixes / 07 — plan settings on superadmin: features, limits and card words
 * as data (config/plans), validated, audited, keeping the ladder, and used by
 * the gates and the billing page at once in this isolate.
 */

let db;
let admin;
let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013p-admin', teacherClaims.superadmin);
  teacher = await userWithClaims('fx013p-teacher', { role: 'teacher' });
});

beforeEach(async () => {
  await clearFirestore();
  await setFlags(db, { 'calendar.enabled': true, 'billing.enabled': true });
});

const plans = (body, token = admin) => call('/api/admin/plans', { token, body });
const status = () => call('/api/billing/status', { method: 'GET', token: teacher });

describe('who may change plans', () => {
  it('only the superadmin', async () => {
    expect((await plans({ action: 'get' }, teacher)).status).toBe(403);
    expect((await plans({ action: 'save', plans: { silver: { limits: { logins: 6 } } } }, teacher)).status).toBe(403);
    expect((await db.doc('config/plans').get()).exists).toBe(false);
  });
});

describe('save, use, reset', () => {
  it('get returns the shipped defaults, no overrides, and the effective plans', async () => {
    const res = await plans({ action: 'get' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.defaults.silver.limits.logins).toBe(5);
    expect(res.body.effective.silver.card.tagline).toBe('Complete tuition management');
    expect(res.body.overrides).toEqual({});
  });

  it('a new limit and card words reach the billing page at once, audited', async () => {
    await seedPlan(db, 'silver');
    const res = await plans({ action: 'save', plans: { silver: { limits: { logins: 6 }, card: { tagline: 'All you need for fees' } } } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const st = await status();
    expect(st.body.plan.limits.logins).toBe(6);
    expect(st.body.plan.catalog.silver.limits.logins).toBe(6);
    expect(st.body.plan.catalog.silver.card.tagline).toBe('All you need for fees');
    expect(st.body.plan.catalog.gold.card.tagline).toBe('Advanced management and automation');

    const audit = (await db.collection('audit').where('action', '==', 'billing.plans_changed').get()).docs[0].data();
    expect(audit).toMatchObject({ target: 'config/plans', after: { silver: { limits: { logins: 6 } } } });
  });

  it('a feature switched off for a plan is refused by the server gate straight away', async () => {
    await seedPlan(db, 'bronze');
    const event = { action: 'create', title: 'Maths', start: '2026-12-07T05:00:00.000Z', end: '2026-12-07T06:00:00.000Z' };
    expect((await call('/api/calendar/manage', { token: teacher, body: event })).status).toBe(200);
    // Calendar off for Bronze only would break the ladder? No — a cheaper plan may LACK what a dearer one has.
    expect((await plans({ action: 'save', plans: { bronze: { features: { calendar: false } } } })).status).toBe(200);
    const refused = await call('/api/calendar/manage', { token: teacher, body: event });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('tier_required');
  });

  it('reset puts a plan back to its defaults', async () => {
    await plans({ action: 'save', plans: { gold: { limits: { smsUnits: 5000 } } } });
    const res = await plans({ action: 'reset', plan: 'gold' });
    expect(res.status).toBe(200);
    expect(res.body.effective.gold.limits.smsUnits).toBe(3000);
    expect((await db.doc('config/plans').get()).data().gold).toBeUndefined();
  });
});

describe('validation', () => {
  it('refuses bad numbers, unknown keys and over-long words', async () => {
    for (const bad of [
      { silver: { limits: { logins: -1 } } },
      { silver: { limits: { logins: 2.5 } } },
      { silver: { limits: { madeUp: 3 } } },
      { silver: { features: { madeUp: true } } },
      { silver: { features: { fees: 'yes' } } },
      { platinum: { limits: { logins: 3 } } },
      { silver: { card: { tagline: 'x'.repeat(81) } } },
      { silver: { card: { bullets: [] } } },
      { silver: { card: { bullets: Array.from({ length: 11 }, (_, i) => `Line ${i}`) } } },
    ]) {
      const res = await plans({ action: 'save', plans: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await db.doc('config/plans').get()).exists).toBe(false);
  });

  it('refuses a broken ladder (a cheaper plan with a feature a dearer one lacks)', async () => {
    // Bronze with choosing recipients while Silver has none: broken.
    const up = await plans({ action: 'save', plans: { bronze: { features: { targetedSms: true } } } });
    expect(up.status).toBe(400);
    expect(up.body.error.code).toBe('plan_ladder');
    const down = await plans({ action: 'save', plans: { silver: { features: { calendar: false } } } });
    expect(down.status).toBe(400); // Bronze has the calendar, so Silver must keep it
    expect((await db.doc('config/plans').get()).exists).toBe(false);
  });
});
