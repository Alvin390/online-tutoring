import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN } from '../_worker.js';

/**
 * 002Fixes / 07 — through the real Worker: a check-in that finds the student
 * hands back a pass; requests carrying a valid pass are not counted by the
 * Firestore limiters (and write no counter documents); any other pass is
 * ignored and the request is limited exactly as before.
 */

let db;
const PHONE = phoneN(6100);

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
});

beforeEach(async () => {
  await clearFirestore();
  await setFlags(db, { 'auth.legacyStudentRead': true });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true });
  await db.doc(`sessions/evening/students/${PHONE}`).set({
    studentName: 'Amina', parentPhone: PHONE, class: 'Form 3', subjects: 'English',
    session: 'evening', blocked: false, approvalStatus: 'pending', receiptStatus: 'pending',
  });
});

const checkin = (phone, { pass, ip, env } = {}) => call('/api/student/checkin', {
  body: { session: 'evening', phone }, ip, env, headers: pass ? { 'x-checkin-pass': pass } : {},
});
const counted = async () => {
  const snap = await db.collection('rateLimits').get();
  return snap.docs.reduce((sum, d) => sum + (d.data().count ?? 0), 0);
};

describe('issuing', () => {
  it('a check-in that finds the student returns a pass; an unknown number gets none', async () => {
    const found = await checkin(PHONE);
    expect(found.status).toBe(200);
    expect(found.body.pass).toMatch(/^v1\.\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(found.body.pass).not.toContain(PHONE.slice(4, 10));
    const unknown = await checkin(phoneN(6199));
    expect(unknown.body).toEqual({ exists: false, student: null });
  });

  it('registering returns a pass', async () => {
    const phone = phoneN(6150);
    const res = await call('/api/student/register', {
      body: { session: 'evening', phone, studentName: 'New Student', class: 'Form 3', subjects: ['English', 'Kiswahili', 'Mathematics'], receiptMessage: 'QAB123XYZ9 Confirmed. Ksh1,000.00 sent' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pass).toMatch(/^v1\./);
  });
});

describe('a valid pass is not counted', () => {
  it('40 "Check again"s in a row from one address all answer, and write no limiter counts', async () => {
    const ip = '203.0.113.40';
    const { pass } = (await checkin(PHONE, { ip })).body;
    const before = await counted(); // the first check-in: one IP count + one phone count
    for (let i = 0; i < 40; i += 1) {
      const res = await checkin(PHONE, { pass, ip });
      expect(res.status, `check ${i + 1}`).toBe(200);
      expect(res.body.student.studentName).toBe('Amina');
    }
    expect(await counted()).toBe(before);
  });

  it('the class link: 130 requests with a pass from one address are never rate-limited', async () => {
    const ip = '203.0.113.130';
    const { pass } = (await checkin(PHONE, { ip })).body;
    for (let i = 0; i < 130; i += 1) {
      const res = await call('/api/class/link', { body: { session: 'evening', phone: PHONE }, ip, headers: { 'x-checkin-pass': pass } });
      expect(res.status, `request ${i + 1}`).not.toBe(429);
    }
  });

  it('entitlement is still checked every time: a pending student with a pass gets no class link', async () => {
    // As production: approval required (the class link only gates on it then).
    await setFlags(db, { 'auth.legacyStudentRead': true, 'registration.requireApproval': true });
    const { pass } = (await checkin(PHONE)).body;
    const res = await call('/api/class/link', { body: { session: 'evening', phone: PHONE }, headers: { 'x-checkin-pass': pass } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('approval_pending');
  });
});

describe('any other pass is ignored — the normal limits apply', () => {
  const twentyFirst = async (pass) => {
    let last;
    for (let i = 0; i < 21; i += 1) last = await checkin(PHONE, { pass, ip: `10.70.${i}.1` });
    return last.status;
  };

  it('a pass for another number', async () => {
    await db.doc(`sessions/evening/students/${phoneN(6101)}`).set({ studentName: 'B', approvalStatus: 'approved', blocked: false });
    const { pass } = (await checkin(phoneN(6101))).body;
    expect(await twentyFirst(pass)).toBe(429);
  });

  it('a tampered pass', async () => {
    const { pass } = (await checkin(PHONE)).body;
    expect(await twentyFirst(`${pass.slice(0, -2)}AA`)).toBe(429);
  });

  it('garbage', async () => {
    expect(await twentyFirst('not-a-pass')).toBe(429);
  });
});

describe('the edge limiter', () => {
  it('past it, a pass holder is counted like anyone else — and the limiter never sees the number', async () => {
    const keys = [];
    const env = { CHECKIN_PASS_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } };
    const { pass } = (await checkin(PHONE)).body;
    let last;
    for (let i = 0; i < 21; i += 1) last = await checkin(PHONE, { pass, ip: `10.71.${i}.1`, env });
    expect(last.status).toBe(429);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith('pass:') && !k.includes(PHONE.slice(4, 10)))).toBe(true);
  });

  it('within it, the pass works', async () => {
    const env = { CHECKIN_PASS_LIMITER: { limit: async () => ({ success: true }) } };
    const { pass } = (await checkin(PHONE)).body;
    for (let i = 0; i < 25; i += 1) expect((await checkin(PHONE, { pass, env })).status).toBe(200);
  });
});
