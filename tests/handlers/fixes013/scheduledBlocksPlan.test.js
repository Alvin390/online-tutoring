import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN, userWithClaims, teacherClaims, seedPlan,
} from '../_worker.js';

/**
 * 013Fixes / 03 — scheduled blocks are Silver and up (owner; they were on
 * every plan). Every action is gated on the server, whatever the login's
 * claim. The per-minute sweep checks the school's plan itself: on a plan
 * without scheduled blocks it cancels what is waiting (check-in would
 * otherwise still block those students at the minute), audited.
 */

let db;
let goldClaim;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  goldClaim = await userWithClaims('fx013s-gold-claim', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true });
  await db.doc('sessions/morning').set({ slug: 'morning', name: 'Morning', active: true });
});

const seed = (phone) => db.doc(`sessions/morning/students/${phone}`).set({
  studentName: 'Student', parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'QAB123XYZ9 Confirmed', registeredAt: new Date('2026-10-01T06:00:00Z'), session: 'morning',
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
});
const student = async (phone) => (await db.doc(`sessions/morning/students/${phone}`).get()).data();
const items = (...phones) => phones.map((phone) => ({ session: 'morning', phone }));
const sched = (body) => call('/api/students/scheduled', { body, token: goldClaim });
const sweep = () => call('/api/cron/scheduledBlocksSweep', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: {} });
const later = () => Date.now() + 60 * 60_000;

describe('every scheduled action needs Silver or Gold', () => {
  it('a Bronze school is refused all of them, even with a Gold claim', async () => {
    await seedPlan(db, 'bronze');
    await seed(phoneN(1));
    for (const body of [
      { action: 'create', items: items(phoneN(1)), atMs: later(), kind: 'other', reason: 'Fees due' },
      { action: 'list' },
      { action: 'reschedule', batchId: 'b1', atMs: later() },
      { action: 'cancel', batchId: 'b1' },
      { action: 'removeMember', batchId: 'b1', session: 'morning', phone: phoneN(1) },
      { action: 'removeMembers', items: items(phoneN(1)) },
    ]) {
      const res = await sched(body);
      expect(res.status, body.action).toBe(403);
      expect(res.body.error.code, body.action).toBe('tier_required');
    }
    expect((await student(phoneN(1))).scheduledBlock).toBeUndefined();
  });

  for (const tier of ['silver', 'gold']) {
    it(`${tier}: create, list, reschedule and cancel`, async () => {
      await seedPlan(db, tier);
      await seed(phoneN(2));
      const created = await sched({ action: 'create', items: items(phoneN(2)), atMs: later(), kind: 'other', reason: 'Fees due' });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      expect((await sched({ action: 'list' })).body.schedules).toHaveLength(1);
      expect((await sched({ action: 'reschedule', batchId: created.body.batchId, atMs: later() + 60_000 })).status).toBe(200);
      expect((await sched({ action: 'cancel', batchId: created.body.batchId })).status).toBe(200);
      expect((await student(phoneN(2))).scheduledBlock).toBeUndefined();
    });
  }

  it('a plain block now is still fine on Bronze', async () => {
    await seedPlan(db, 'bronze');
    await seed(phoneN(3));
    const res = await call('/api/students/bulk', { token: goldClaim, body: { action: 'block', kind: 'other', reason: 'Fees due', items: items(phoneN(3)) } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await student(phoneN(3))).blocked).toBe(true);
  });
});

describe('the sweep checks the school\'s plan every run', () => {
  async function waitingSchedule(phone) {
    await seedPlan(db, 'silver');
    await seed(phone);
    const res = await sched({ action: 'create', items: items(phone), atMs: later(), kind: 'other', reason: 'Fees due' });
    expect(res.status).toBe(200);
    return res.body.batchId;
  }

  it('after a downgrade to Bronze it cancels what is waiting, audited, and blocks nobody', async () => {
    const id = await waitingSchedule(phoneN(4));
    // Due already, so a Silver sweep WOULD apply it now.
    await db.doc(`scheduledBlocks/${id}`).update({ dueAtMs: Date.now() - 1000 });
    await seedPlan(db, 'bronze');

    const res = await sweep();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.cancelledForPlan).toBe(1);

    const schedule = (await db.doc(`scheduledBlocks/${id}`).get()).data();
    expect(schedule).toMatchObject({ status: 'cancelled', cancelledBecause: 'plan' });
    expect(schedule.dueAtMs).toBeUndefined();
    const s = await student(phoneN(4));
    expect(s.scheduledBlock).toBeUndefined();
    expect(s.blocked).toBe(false);

    const audit = await db.collection('audit').where('action', '==', 'students.schedule_cancelled_plan').get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0].data()).toMatchObject({ target: `scheduledBlocks/${id}`, after: { tier: 'bronze' } });
  });

  it('with no subscription at all it cancels too (no plan)', async () => {
    const id = await waitingSchedule(phoneN(5));
    await db.doc('subscription/current').delete();
    (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
    expect((await sweep()).body.cancelledForPlan).toBe(1);
    expect((await db.doc(`scheduledBlocks/${id}`).get()).data().status).toBe('cancelled');
  });

  it('on Silver it applies a due schedule as before', async () => {
    const id = await waitingSchedule(phoneN(6));
    await db.doc(`scheduledBlocks/${id}`).update({ dueAtMs: Date.now() - 1000 });
    const res = await sweep();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ blocked: 1 });
    expect((await student(phoneN(6))).blocked).toBe(true);
  });

  it('a lapsed Silver school keeps its schedules (billing status never changes the plan)', async () => {
    const id = await waitingSchedule(phoneN(7));
    await seedPlan(db, 'silver', { status: 'locked' });
    const res = await sweep();
    expect(res.body.cancelledForPlan).toBeUndefined();
    expect((await db.doc(`scheduledBlocks/${id}`).get()).data().status).toBe('scheduled');
  });

  it('nothing waiting: one query, and the plan is not even read', async () => {
    await seedPlan(db, 'bronze');
    const res = await sweep();
    expect(res.body).toMatchObject({ ok: true, schedules: 0 });
    expect(res.body.cancelledForPlan).toBeUndefined();
  });
});
