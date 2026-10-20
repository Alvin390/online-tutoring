import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, drainWaitUntil,
  userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * Phase 13 / 08 — Worker and API performance with functional consequences:
 * the check-in path (C2 one-round-trip limiter, C4 batched reads, B3 heartbeat
 * off the student document), and the student delete counting with meta docs.
 */

let db;
const PHONE = '+254700100200';
const studentPath = `sessions/morning/students/${PHONE}`;
const activityPath = `${studentPath}/meta/activity`;
const subreq = (res) => Number(/subreq;desc="(\d+)"/.exec(res.headers.get('server-timing') ?? '')?.[1]);

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
});

beforeEach(async () => {
  await clearFirestore();
  await setFlags(db, { 'auth.legacyStudentRead': true });
  await db.doc('sessions/morning').set({ slug: 'morning', name: 'Morning', active: true });
  await db.doc(studentPath).set({
    studentName: 'Amina', parentPhone: PHONE, class: 'Grade 8', subjects: 'Maths',
    session: 'morning', blocked: false, approvalStatus: 'approved', receiptStatus: 'approved',
  });
  process.env.PERF_TIMING = '1';
});

afterEach(() => { delete process.env.PERF_TIMING; });

const checkin = () => call('/api/student/checkin', { body: { session: 'morning', phone: PHONE } });

describe('check-in (C2, C4, B3)', () => {
  it('answers from the student document and never writes it (dashboards do not re-render)', async () => {
    const before = (await db.doc(studentPath).get()).updateTime.toMillis();
    const res = await checkin();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ exists: true, student: { studentName: 'Amina', approvalStatus: 'approved' } });
    await drainWaitUntil();
    const after = await db.doc(studentPath).get();
    expect(after.updateTime.toMillis()).toBe(before);
    expect(after.data().lastAccessed).toBeUndefined();
    expect((await db.doc(activityPath).get()).data().lastAccessed).toBeTruthy();
  });

  it('writes the heartbeat at most once per 10 minutes', async () => {
    await checkin();
    await drainWaitUntil();
    const first = (await db.doc(activityPath).get()).updateTime.toMillis();
    await checkin();
    await drainWaitUntil();
    expect((await db.doc(activityPath).get()).updateTime.toMillis()).toBe(first);

    await db.doc(activityPath).set({ lastAccessed: new Date(Date.now() - 11 * 60_000) });
    const stale = (await db.doc(activityPath).get()).updateTime.toMillis();
    await checkin();
    await drainWaitUntil();
    expect((await db.doc(activityPath).get()).updateTime.toMillis()).toBeGreaterThan(stale);
  });

  it('costs at most 3 subrequests on the response path (IP limiter, phone limiter, one batchGet)', async () => {
    await checkin(); // warm the session/flag caches, as production isolates are
    await drainWaitUntil();
    const res = await checkin();
    expect(res.status).toBe(200);
    expect(subreq(res)).toBeLessThanOrEqual(3);
  });

  it('an unknown number looks the same and costs the same', async () => {
    await checkin();
    const res = await call('/api/student/checkin', { body: { session: 'morning', phone: '+254700999888' } });
    expect(res.body).toEqual({ exists: false, student: null });
    expect(subreq(res)).toBeLessThanOrEqual(3);
  });

  it('the phone limit still applies (21st check-in for one number → 429)', async () => {
    let last;
    for (let i = 0; i < 21; i += 1) {
      last = await call('/api/student/checkin', { body: { session: 'morning', phone: PHONE }, ip: `10.77.0.${i}` });
    }
    expect(last.status).toBe(429);
  });
});

describe('student delete with a heartbeat marker (B3)', () => {
  it('removes meta/activity too, and still reports notes only', async () => {
    const teacher = await userWithClaims('p13-perf-teacher', teacherClaims.gold);
    await checkin();
    await drainWaitUntil();
    await db.doc(`${studentPath}/notes/n1`).set({ body: 'x', deletedAt: null });
    const res = await call('/api/student/remove', { token: teacher, body: { session: 'morning', phone: PHONE } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.notesRemoved).toBe(1);
    expect((await db.doc(activityPath).get()).exists).toBe(false);
  });
});

describe('ICS feed ETag (C6)', () => {
  it('an unchanged feed answers 304 with no body; a change gives a new ETag', async () => {
    await setFlags(db, { 'calendar.enabled': true, 'auth.legacyStudentRead': true });
    const { issueFeedToken } = await import('../../../api/calendar/export.js');
    const token = await issueFeedToken(db, { role: 'teacher', session: null, phone: null, issuedBy: 't1' });
    await db.doc('calendar/events/items/e1').set({
      title: 'Maths', start: new Date('2026-10-05T05:00:00Z'), end: new Date('2026-10-05T06:00:00Z'),
      sessionIds: [], recurrence: null, isRecurring: false, recurrenceExceptions: [],
    });
    const url = `/api/calendar/export?token=${token}`;

    const first = await call(url, { method: 'GET' });
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^W\/"[0-9a-f]{32}"$/);

    const again = await call(url, { method: 'GET', headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
    expect(again.body).toBe('');

    await db.doc('calendar/events/items/e1').set({ title: 'Mathematics' }, { merge: true });
    const changed = await call(url, { method: 'GET', headers: { 'if-none-match': etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
    expect(changed.body).toContain('SUMMARY:Mathematics');
  });
});

// Phase 13 / 08 D3 — contention. Run locally in the Worker harness rather than
// with k6 (not installed, and never against production). The emulator's lock
// model starves REST transactions beyond about a dozen simultaneous writers to
// ONE document (see firestoreParity.test.js), so the default run uses the
// level a one-teacher app actually sees; the 20-way case is opt-in. What is
// asserted is the money property: nothing lost, nothing double-applied, and a
// request that loses the race is told to retry (503 busy), never a bare 500.
describe('ledger under contention (D3)', () => {
  async function postConcurrently(n, phone) {
    await setFlags(db, { 'fees.enabled': true, 'auth.legacyStudentRead': true });
    const teacher = await userWithClaims('p13-perf-silver', teacherClaims.silver);
    await db.doc(`sessions/morning/students/${phone}`).set({
      studentName: 'Busy', parentPhone: phone, class: 'G8', subjects: 'Maths', receiptMessage: 'QAB123XYZ9 x',
      registeredAt: new Date(), session: 'morning', blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
    });
    await db.doc(`fees/accounts/items/${phone}`).set({ phone, session: 'morning', balance: 0 });
    const amounts = Array.from({ length: n }, (_, i) => 100 + i);
    const results = await Promise.all(amounts.map((amount, i) => call('/api/fees/post', {
      token: teacher, ip: `10.88.${n}.${i}`,
      body: { session: 'morning', phone, type: 'invoice', amount },
    })));
    const ledger = await db.collection(`fees/accounts/items/${phone}/ledger`).get();
    const balance = (await db.doc(`fees/accounts/items/${phone}`).get()).data().balance;
    return { results, ledger, balance };
  }

  function assertConsistent({ results, ledger, balance }) {
    const ok = results.filter((r) => r.status === 200);
    for (const r of results.filter((x) => x.status !== 200)) {
      expect([r.status, r.body?.error?.code]).toEqual([503, 'busy']);
      expect(r.headers.get('retry-after')).toBe('1');
    }
    expect(ok.length).toBeGreaterThan(0);
    expect(ledger.size).toBe(ok.length);                       // nothing lost, nothing extra
    const sum = ledger.docs.reduce((acc, d) => acc + d.data().amount, 0);
    expect(balance).toBe(sum);                                 // balance agrees with its entries
  }

  it('5 concurrent fees/post on one student: every success is in the ledger and the balance equals its sum', async () => {
    assertConsistent(await postConcurrently(5, '+254700100300'));
  }, 120_000);

  it.runIf(process.env.FIRESTORE_STRESS === '1')('20-way stress: still consistent', async () => {
    assertConsistent(await postConcurrently(20, '+254700100301'));
  }, 240_000);
});
