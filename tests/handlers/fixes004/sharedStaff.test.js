import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 004Fixes / 02 — one school, several staff logins, one roster (production has
 * two Gold teacher accounts and the superadmin). Owner decision: every staff
 * account sees and manages everything — scheduled blocks, Recent actions, Undo
 * and the WhatsApp hand-off — not only what it created. Who did what is kept
 * (createdBy, lastChangedBy, the audit trail).
 */

let db; let teacherA; let teacherB; let superadmin;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacherA = await userWithClaims('fx004-teacher-a', teacherClaims.gold, { email: 'teacher.a@school.example' });
  teacherB = await userWithClaims('fx004-teacher-b', teacherClaims.gold, { email: 'teacher.b@school.example' });
  superadmin = await userWithClaims('fx004-super', teacherClaims.superadmin, { email: 'owner@school.example' });
});
beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true });
  for (const n of [1, 2, 3]) {
    await db.doc(`sessions/evening/students/${phoneN(n)}`).set({
      studentName: `Student ${n}`, parentPhone: phoneN(n), class: 'Form 3', subjects: 'English', receiptMessage: 'QAB123XYZ9 Confirmed',
      registeredAt: new Date('2026-10-01T06:00:00Z'), session: 'evening', blocked: false, blockReason: '',
      approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
    });
  }
});
afterEach(() => vi.useRealTimers());

const sched = (body, token) => call('/api/students/scheduled', { body, token });
const bulk = (body, token) => call('/api/students/bulk', { body, token });
const items = (...ns) => ns.map((n) => ({ session: 'evening', phone: phoneN(n) }));
const student = async (n) => (await db.doc(`sessions/evening/students/${phoneN(n)}`).get()).data();
const audits = async (action) => (await db.collection('audit').where('action', '==', action).get()).docs.map((d) => d.data());

async function aSchedules() {
  const res = await sched({ action: 'create', items: items(1, 2, 3), atMs: Date.now() + 17 * 3_600_000, kind: 'fees', amount: 1500 }, teacherA);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.batchId;
}

describe('scheduled blocks are shared by every staff account', () => {
  it('teacher B and the superadmin see teacher A\'s schedule, with who made it', async () => {
    const id = await aSchedules();
    for (const token of [teacherA, teacherB, superadmin]) {
      const list = (await sched({ action: 'list' }, token)).body.schedules;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id, count: 3, createdBy: 'teacher.a@school.example' });
    }
  });

  it('teacher B reschedules it; the change is recorded against B', async () => {
    const id = await aSchedules();
    const later = Date.now() + 30 * 3_600_000;
    const res = await sched({ action: 'reschedule', batchId: id, atMs: later }, teacherB);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await student(1)).scheduledBlock.atMs).toBe(later);
    const doc = (await db.doc(`scheduledBlocks/${id}`).get()).data();
    expect(doc.lastChangedBy).toMatchObject({ uid: 'fx004-teacher-b', email: 'teacher.b@school.example' });
    expect((await audits('students.schedule_rescheduled')).map((a) => a.actor)).toEqual(['fx004-teacher-b']);
  });

  it('teacher B takes one student out, and the row × / "Cancel schedule" really removes them', async () => {
    const id = await aSchedules();
    const res = await sched({ action: 'removeMembers', items: items(1) }, teacherB);
    expect(res.body).toMatchObject({ removed: 1 });
    expect((await student(1)).scheduledBlock).toBeUndefined();
    expect((await sched({ action: 'list' }, teacherA)).body.schedules[0].count).toBe(2);
    expect((await sched({ action: 'removeMember', batchId: id, session: 'evening', phone: phoneN(2) }, superadmin)).status).toBe(200);
    expect((await student(2)).scheduledBlock).toBeUndefined();
  });

  it('teacher B cancels it', async () => {
    const id = await aSchedules();
    expect((await sched({ action: 'cancel', batchId: id }, teacherB)).status).toBe(200);
    expect((await student(3)).scheduledBlock).toBeUndefined();
    expect((await sched({ action: 'list' }, teacherA)).body.schedules).toEqual([]);
    expect((await audits('students.schedule_cancelled')).map((a) => a.actor)).toEqual(['fx004-teacher-b']);
  });

  it('teacher B adds students to teacher A\'s schedule (a selection over 25 continues the same schedule)', async () => {
    await db.doc(`sessions/evening/students/${phoneN(4)}`).set({ ...(await student(1)), studentName: 'Student 4', parentPhone: phoneN(4), scheduledBlock: null });
    const id = await aSchedules();
    const res = await sched({ action: 'create', batchId: id, items: items(4), atMs: Date.now() + 17 * 3_600_000, kind: 'fees', amount: 1500 }, teacherB);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await sched({ action: 'list' }, teacherA)).body.schedules[0].count).toBe(4);
  });

  it('a closed schedule stays closed for everyone', async () => {
    const id = await aSchedules();
    await sched({ action: 'cancel', batchId: id }, teacherA);
    expect((await sched({ action: 'cancel', batchId: id }, teacherB)).status).toBe(400);
  });

  it('students still cannot reach it', async () => {
    await aSchedules();
    expect((await sched({ action: 'list' })).status).toBe(401);
  });
});

describe('bulk actions (Recent actions, Undo, WhatsApp parents) are shared too', () => {
  async function aBlocks() {
    const res = await bulk({ action: 'block', kind: 'other', reason: 'Fees due', items: items(1, 2) }, teacherA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.batchId;
  }

  it('teacher B sees teacher A\'s action in Recent actions, with who made it', async () => {
    const id = await aBlocks();
    for (const token of [teacherB, superadmin]) {
      const actions = (await bulk({ action: 'list' }, token)).body.actions;
      expect(actions.map((a) => a.id)).toEqual([id]);
      expect(actions[0]).toMatchObject({ createdBy: 'teacher.a@school.example' });
    }
  });

  it('teacher B undoes it within 30 minutes; the undo is recorded against B', async () => {
    const id = await aBlocks();
    const res = await bulk({ action: 'undo', batchId: id }, teacherB);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'undone', undone: 2 });
    expect((await student(1)).blocked).toBe(false);
    expect((await db.doc(`bulkActions/${id}`).get()).data().lastChangedBy).toMatchObject({ uid: 'fx004-teacher-b' });
    expect((await audits('students.bulk_undone')).map((a) => a.actor)).toEqual(['fx004-teacher-b']);
  });

  it('after 30 minutes nobody can undo it', async () => {
    const id = await aBlocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect((await bulk({ action: 'undo', batchId: id }, teacherB)).status).toBe(410);
  });

  it('teacher B reads who it reached (WhatsApp parents)', async () => {
    const id = await aBlocks();
    const res = await bulk({ action: 'items', batchId: id }, teacherB);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });
});
