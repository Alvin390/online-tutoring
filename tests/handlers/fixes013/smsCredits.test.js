import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, seedPlan,
} from '../_worker.js';

/**
 * 013Fixes / 14 — the SMS units ledger: included units per window by plan
 * (trial 100, comp per Nairobi month), written off when the window changes;
 * top-ups added by the superadmin carry forward; an upgrade adds the
 * difference once; a downgrade takes nothing away mid-window. Append-only
 * and idempotent; no money anywhere.
 */

let db;
let admin;
const start = new Date('2026-10-14T13:00:00Z');

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013c-admin', teacherClaims.superadmin);
});

beforeEach(async () => {
  await clearFirestore();
});

const credits = () => call('/api/admin/sms', { token: admin, body: { action: 'credits' } });
const addUnits = (units, key, note) => call('/api/admin/sms', { token: admin, body: { action: 'addUnits', units, key, ...(note ? { note } : {}) } });
const ledger = async () => (await db.collection('sms/credits/ledger').get()).docs.map((d) => ({ id: d.id, ...d.data() }));

describe('included units per window', () => {
  for (const [tier, units] of [['silver', 1000], ['gold', 3000], ['bronze', 0]]) {
    it(`${tier}: ${units} for the period`, async () => {
      await seedPlan(db, tier, { currentPeriodStart: start });
      const res = await credits();
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.credits).toMatchObject({ windowId: `period-${start.getTime()}`, granted: units, includedLeft: units, topup: 0 });
    });
  }

  it('a trial gets 100; a comp school its calendar month', async () => {
    await seedPlan(db, 'gold', { status: 'trialing', currentPeriodStart: start });
    expect((await credits()).body.credits).toMatchObject({ windowId: `trial-${start.getTime()}`, granted: 100 });
    await clearFirestore();
    await seedPlan(db, 'gold', { grantedBySuperadmin: true, currentPeriodStart: start });
    const c = (await credits()).body.credits;
    expect(c.windowId).toMatch(/^month-\d{4}-\d{2}$/);
    expect(c.granted).toBe(3000);
  });

  it('a second read in the same window grants nothing more', async () => {
    await seedPlan(db, 'silver', { currentPeriodStart: start });
    await credits();
    await credits();
    expect((await ledger()).filter((e) => e.type === 'grant')).toHaveLength(1);
  });

  it('a new window writes off what was left and grants afresh; top-ups carry over', async () => {
    await seedPlan(db, 'silver', { currentPeriodStart: start });
    await credits();
    await db.doc('sms/credits').set({ includedUsed: 300 }, { merge: true });
    await addUnits(50, 'carryover-key-1');
    const next = new Date('2026-11-14T13:00:00Z'); // both periods have begun
    await seedPlan(db, 'silver', { currentPeriodStart: next });
    const c = (await credits()).body.credits;
    expect(c).toMatchObject({ windowId: `period-${next.getTime()}`, granted: 1000, includedUsed: 0, topup: 50, available: 1050 });
    const expire = (await ledger()).find((e) => e.type === 'expire');
    expect(expire).toMatchObject({ units: -700, windowId: `period-${start.getTime()}` });
  });
});

describe('plan changes inside a window', () => {
  it('Silver → Gold adds the difference once; Gold → Silver takes nothing away', async () => {
    await seedPlan(db, 'silver', { currentPeriodStart: start });
    await credits();
    await seedPlan(db, 'gold', { currentPeriodStart: start });
    expect((await credits()).body.credits.granted).toBe(3000);
    expect((await credits()).body.credits.granted).toBe(3000);
    expect((await ledger()).filter((e) => e.type === 'upgrade_top')).toEqual([expect.objectContaining({ units: 2000 })]);
    await seedPlan(db, 'silver', { currentPeriodStart: start });
    expect((await credits()).body.credits.granted).toBe(3000);
    await seedPlan(db, 'gold', { currentPeriodStart: start });
    expect((await credits()).body.credits.granted).toBe(3000); // never granted twice
    expect((await ledger()).filter((e) => e.type === 'upgrade_top')).toHaveLength(1);
  });
});

describe('top-ups by hand', () => {
  it('superadmin only; added once per key; audited; no money', async () => {
    await seedPlan(db, 'gold', { currentPeriodStart: start });
    const teacher = await userWithClaims('fx013c-teacher', { role: 'teacher' });
    expect((await call('/api/admin/sms', { token: teacher, body: { action: 'addUnits', units: 10, key: 'teacher-key-123' } })).status).toBe(403);

    const first = await addUnits(500, 'double-click-key-1', 'MPESA ABC123');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ added: 500, already: false, credits: { topup: 500, available: 3500 } });
    const again = await addUnits(500, 'double-click-key-1', 'MPESA ABC123');
    expect(again.body).toMatchObject({ added: 0, already: true, credits: { topup: 500 } });
    expect((await ledger()).filter((e) => e.type === 'topup_added')).toEqual([expect.objectContaining({ units: 500, note: 'MPESA ABC123', actor: 'fx013c-admin' })]);
    expect((await db.collection('audit').where('action', '==', 'sms.units_added').get()).size).toBe(1);
    expect(JSON.stringify(await ledger())).not.toMatch(/KES|cost|price/i);
  });

  it('refuses a bad number of units or a missing key', async () => {
    await seedPlan(db, 'gold', { currentPeriodStart: start });
    expect((await addUnits(0, 'zero-units-key-1')).status).toBe(400);
    expect((await addUnits(2.5, 'half-units-key-1')).status).toBe(400);
    expect((await call('/api/admin/sms', { token: admin, body: { action: 'addUnits', units: 10 } })).status).toBe(400);
  });
});
