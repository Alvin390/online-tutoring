import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, seedPlan, phoneN,
} from '../_worker.js';

/**
 * 013Fixes / 11 — the usage count (spec §4): unique active learners across
 * sessions in the school's window, sessions switched on, logins in use;
 * stored in config/usage. Counting never blocks or changes anything else.
 */

const CRON = () => ({ authorization: `Bearer ${process.env.CRON_SECRET}` });
const DAY = 86_400_000;
let db;
let admin;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013u-admin', teacherClaims.superadmin);
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true });
  await db.doc('sessions/old').set({ slug: 'old', name: 'Old', active: false });
});

/** A student and, optionally, when they last checked in. */
async function learner(session, phone, { seenMsAgo = 60_000, ...extra } = {}) {
  await db.doc(`sessions/${session}/students/${phone}`).set({
    studentName: 'Kid', parentPhone: phone, class: 'Form 3', session, approvalStatus: 'approved', blocked: false, ...extra,
  });
  if (seenMsAgo != null) {
    await db.doc(`sessions/${session}/students/${phone}/meta/activity`).set({ lastAccessed: new Date(Date.now() - seenMsAgo) });
  }
}

const recount = () => call('/api/admin/users', { token: admin, body: { action: 'recountUsage' } });
const stored = async () => (await db.doc('config/usage').get()).data();

describe('who counts as an active learner', () => {
  it('one per phone across sessions; staff, pending, rejected, held, retired and unseen count zero', async () => {
    await seedPlan(db, 'silver', { currentPeriodStart: new Date(Date.now() - 10 * DAY), currentPeriodEnd: new Date(Date.now() + 20 * DAY) });
    await learner('morning', phoneN(1));
    await learner('evening', phoneN(1)); // the same learner in two sessions: one
    await learner('morning', phoneN(2));
    await learner('evening', phoneN(3), { approvalStatus: undefined }); // a pre-approval record counts as approved
    await learner('morning', phoneN(4), { staff: true });
    await learner('morning', phoneN(5), { approvalStatus: 'pending' });
    await learner('morning', phoneN(6), { approvalStatus: 'rejected' });
    await learner('morning', phoneN(7), { duplicateHold: true });
    await learner('evening', phoneN(8));
    await db.doc(`sessions/evening/retiredNumbers/${phoneN(8)}`).set({ reason: 'merged' });
    await learner('morning', phoneN(9), { seenMsAgo: 20 * DAY }); // before this period
    await learner('morning', phoneN(10), { seenMsAgo: null }); // never checked in

    const res = await recount();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.usage).toMatchObject({ activeStudents: 3, sessions: 2, windowKind: 'period', tier: 'silver' });
    expect(res.body.usage.limits).toMatchObject({ activeStudents: 300, sessions: 5 });
    expect(res.body.usage.percent.activeStudents).toBe(1);
    expect(await stored()).toMatchObject({ activeStudents: 3, sessions: 2, countedBy: 'fx013u-admin' });
  });

  it('a recount gives the same answer', async () => {
    await seedPlan(db, 'gold');
    await learner('morning', phoneN(11));
    const a = (await recount()).body.usage;
    const b = (await recount()).body.usage;
    expect([a.activeStudents, a.sessions, a.logins]).toEqual([b.activeStudents, b.sessions, b.logins]);
  });
});

describe('the window', () => {
  it('a comp school counts from the 1st of the Nairobi month, whatever its stored period', async () => {
    await seedPlan(db, 'gold', { grantedBySuperadmin: true, currentPeriodStart: new Date('2020-01-01T00:00:00Z') });
    const usage = (await recount()).body.usage;
    expect(usage.windowKind).toBe('month');
    const start = new Date(usage.windowStart);
    expect(start.getUTCHours()).toBe(21); // 00:00 in Nairobi
    expect(new Date(start.getTime() + 3 * 3_600_000).getUTCDate()).toBe(1);
  });

  it('a paying school counts from its own period start', async () => {
    const begin = new Date(Date.now() - 3 * DAY);
    await seedPlan(db, 'silver', { currentPeriodStart: begin, currentPeriodEnd: new Date(Date.now() + 27 * DAY) });
    await learner('morning', phoneN(12), { seenMsAgo: 5 * DAY }); // before this period, this month
    const usage = (await recount()).body.usage;
    expect(usage).toMatchObject({ windowKind: 'period', activeStudents: 0 });
    expect(new Date(usage.windowStart).getTime()).toBe(begin.getTime());
  });
});

describe('when it runs', () => {
  it('the hourly trigger recounts once a day: a second run within the day only reads', async () => {
    await seedPlan(db, 'bronze');
    const first = await call('/api/cron/usageCount', { headers: CRON(), body: {} });
    expect(first.body.recounted).toBe(true);
    const second = await call('/api/cron/usageCount', { headers: CRON(), body: {} });
    expect(second.body.recounted).toBe(false);
    await db.doc('config/usage').set({ countedAtMs: Date.now() - 24 * 3_600_000 }, { merge: true });
    expect((await call('/api/cron/usageCount', { headers: CRON(), body: {} })).body.recounted).toBe(true);
  });

  it('needs the cron secret; "Recount now" needs the superadmin', async () => {
    expect((await call('/api/cron/usageCount', { body: {} })).status).toBe(401);
    const teacher = await userWithClaims('fx013u-teacher', { role: 'teacher' });
    expect((await call('/api/admin/users', { token: teacher, body: { action: 'recountUsage' } })).status).toBe(403);
  });

  it('being over every limit changes nothing else (counting is all it does)', async () => {
    await seedPlan(db, 'bronze'); // 100 learners, 2 sessions
    await db.doc('sessions/third').set({ slug: 'third', name: 'Third', active: true });
    const usage = (await recount()).body.usage;
    expect(usage.sessions).toBe(3);
    expect(usage.percent.sessions).toBe(150);
    expect((await db.doc('subscription/current').get()).data()).toMatchObject({ tier: 'bronze', status: 'active' });
  });
});

describe('cost', () => {
  it('500 students in two sessions: one run stays well inside the per-run budget', async () => {
    await seedPlan(db, 'gold');
    for (const [session, from] of [['morning', 0], ['evening', 250]]) {
      const batch = db.batch();
      for (let i = from; i < from + 250; i += 1) {
        const phone = phoneN(5000 + i);
        batch.set(db.doc(`sessions/${session}/students/${phone}`), { studentName: 'Kid', parentPhone: phone, class: 'Form 3', session, approvalStatus: 'approved' });
        batch.set(db.doc(`sessions/${session}/students/${phone}/meta/activity`), { lastAccessed: new Date() });
      }
      await batch.commit();
    }
    const t0 = Date.now();
    const res = await call('/api/cron/usageCount?force=1', { headers: CRON(), body: {} });
    const ms = Date.now() - t0;
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await stored()).activeStudents).toBe(500);
    // 2 for sessions + subscription, then per session: students + retired + one batchGet; plus plan, seats.
    expect(res.body.subrequests).toBeLessThanOrEqual(20);
    console.log(`[p11] usage count, 500 students: ${res.body.subrequests} subrequests, ${ms} ms (emulator)`);
  }, 120_000);
});

