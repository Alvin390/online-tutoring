import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 004Fixes / 05 — every bulk action, undo and schedule change keeps a short
 * device note (browser, OS, Cloudflare network) on its record and in the
 * audit, and an undone action says who undid it. Cloudflare's request logs
 * keep 3 days; this keeps the answer. Never an IP address.
 */

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0';
const IP = '203.0.113.77';

let db; let teacherA; let teacherB;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacherA = await userWithClaims('fx004-dev-a', teacherClaims.gold, { email: 'device.a@school.example' });
  teacherB = await userWithClaims('fx004-dev-b', teacherClaims.gold, { email: 'device.b@school.example' });
});
beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true });
  await db.doc('sessions/morning').set({ slug: 'morning', name: 'Morning', active: true });
  for (const n of [1, 2]) {
    await db.doc(`sessions/morning/students/${phoneN(n)}`).set({
      studentName: `Student ${n}`, parentPhone: phoneN(n), class: 'Form 3', subjects: 'English', receiptMessage: 'QAB123XYZ9 Confirmed',
      registeredAt: new Date('2026-10-01T06:00:00Z'), session: 'morning', blocked: false, blockReason: '',
      approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
    });
  }
});

const items = (...ns) => ns.map((n) => ({ session: 'morning', phone: phoneN(n) }));
const as = (token, ua) => ({ token, ip: IP, headers: { 'user-agent': ua } });
const bulk = (body, token, ua) => call('/api/students/bulk', { body, ...as(token, ua) });
const sched = (body, token, ua) => call('/api/students/scheduled', { body, ...as(token, ua) });
const audit = async (action) => (await db.collection('audit').where('action', '==', action).get()).docs.map((d) => d.data());
const chromeWin = { browser: 'Chrome 155', os: 'Windows', network: null };
const firefoxWin = { browser: 'Firefox 159', os: 'Windows', network: null };

describe('bulk actions', () => {
  it('the block records its device; the undo records who undid it, from which device, and when', async () => {
    const res = await bulk({ action: 'block', kind: 'other', reason: 'r', items: items(1, 2) }, teacherA, CHROME);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const id = res.body.batchId;
    expect((await db.doc(`bulkActions/${id}`).get()).data().createdBy).toEqual({ uid: 'fx004-dev-a', email: 'device.a@school.example', device: chromeWin });
    expect((await audit('students.bulk_block'))[0].context.device).toEqual(chromeWin);

    expect((await bulk({ action: 'undo', batchId: id }, teacherB, FIREFOX)).status).toBe(200);
    const doc = (await db.doc(`bulkActions/${id}`).get()).data();
    expect(doc.undoneBy).toEqual({ uid: 'fx004-dev-b', email: 'device.b@school.example', device: firefoxWin });
    expect(doc.lastChangedBy.device).toEqual(firefoxWin);
    expect((await audit('students.bulk_undone'))[0].context.device).toEqual(firefoxWin);

    const listed = (await bulk({ action: 'list' }, teacherA, CHROME)).body.actions[0];
    expect(listed).toMatchObject({ status: 'undone', undoneBy: 'device.b@school.example' });
    expect(listed.undoneAtMs).toBeGreaterThan(0);
  });

  it('no IP address is stored on the record or in the audit', async () => {
    const res = await bulk({ action: 'block', kind: 'other', items: items(1) }, teacherA, CHROME);
    await bulk({ action: 'undo', batchId: res.body.batchId }, teacherA, CHROME);
    const stored = JSON.stringify([(await db.doc(`bulkActions/${res.body.batchId}`).get()).data(), ...(await audit('students.bulk_block')), ...(await audit('students.bulk_undone'))]);
    expect(stored).not.toContain('203.0.113');
  });
});

describe('scheduled blocks', () => {
  it('create, reschedule and cancel each record the device', async () => {
    const res = await sched({ action: 'create', items: items(1), atMs: Date.now() + 86_400_000, kind: 'other' }, teacherA, CHROME);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const id = res.body.batchId;
    expect((await db.doc(`scheduledBlocks/${id}`).get()).data().createdBy.device).toEqual(chromeWin);
    expect((await audit('students.block_scheduled'))[0].context.device).toEqual(chromeWin);

    await sched({ action: 'reschedule', batchId: id, atMs: Date.now() + 2 * 86_400_000 }, teacherB, FIREFOX);
    expect((await db.doc(`scheduledBlocks/${id}`).get()).data().lastChangedBy.device).toEqual(firefoxWin);
    expect((await audit('students.schedule_rescheduled'))[0].context.device).toEqual(firefoxWin);

    await sched({ action: 'cancel', batchId: id }, teacherA, CHROME);
    expect((await audit('students.schedule_cancelled'))[0].context.device).toEqual(chromeWin);
  });

  it('the sweep\'s bulk record keeps the device of whoever scheduled it', async () => {
    const res = await sched({ action: 'create', items: items(2), atMs: Date.now() + 10 * 60_000, kind: 'other' }, teacherA, CHROME);
    const id = res.body.batchId;
    const now = Date.now() - 1000;
    await db.doc(`scheduledBlocks/${id}`).set({ atMs: now, dueAtMs: now }, { merge: true });
    await db.doc(`sessions/morning/students/${phoneN(2)}`).set({ scheduledBlock: { atMs: now } }, { merge: true });
    const sweep = await call('/api/cron/scheduledBlocksSweep', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: {} });
    expect(sweep.body.blocked).toBe(1);
    const bulkId = (await db.doc(`scheduledBlocks/${id}`).get()).data().bulkActionId;
    expect((await db.doc(`bulkActions/${bulkId}`).get()).data().createdBy).toMatchObject({ uid: 'fx004-dev-a', device: chromeWin });
  });
});
