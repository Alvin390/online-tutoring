import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * Phase 13 / 08 A1 — the two endpoints that let public pages drop the
 * Firestore SDK: /api/public/bootstrap and /api/student/register.
 */

let db;
let gold;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims('p13-public-teacher', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  await db.doc('sessions/morning').set({
    slug: 'morning', name: 'Morning Session', active: true, order: 1,
    description: 'Start your day', schedule: { start: '08:00', end: '12:00', days: [], tz: 'Africa/Nairobi' },
    icon: 'bi-sunrise', gradient: 'linear-gradient(1)', createdBy: 'secret-uid', studentCount: 41,
  });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true, order: 2 });
  await db.doc('sessions/hidden').set({ slug: 'hidden', name: 'Hidden', active: false, order: 3 });
});

// ---------------------------------------------------------------------------
describe('GET /api/public/bootstrap', () => {
  it('returns the flags and ONLY the presentation fields of ACTIVE sessions, in order', async () => {
    await setFlags(db, { 'fees.enabled': true });
    const res = await call('/api/public/bootstrap', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['flags', 'payments', 'sessions']);
    expect(res.body.payments).toEqual({ mpesa: false }); // flag off in this suite
    expect(res.body.flags['fees.enabled']).toBe(true);
    expect(res.body.sessions.map((s) => s.slug)).toEqual(['morning', 'evening']);
    expect(Object.keys(res.body.sessions[0]).sort())
      .toEqual(['classes', 'description', 'gradient', 'icon', 'name', 'order', 'schedule', 'slug', 'subjectsByClass']);
    // No list on the document -> the defaults the form has always offered.
    expect(res.body.sessions[0].classes).toEqual(['Grade 7', 'Grade 8', 'Grade 10', 'Form 3']);
    expect(JSON.stringify(res.body)).not.toMatch(/secret-uid|studentCount/);
  });

  it('is cacheable by the browser and served from the isolate cache on the next request', async () => {
    const first = await call('/api/public/bootstrap', { method: 'GET' });
    expect(first.headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=300');
    await db.doc('sessions/evening').set({ active: false }, { merge: true }); // a raw write: no invalidation
    const second = await call('/api/public/bootstrap', { method: 'GET' });
    expect(second.body.sessions.map((s) => s.slug)).toEqual(['morning', 'evening']); // cached
  });

  it('a session change through the API is visible at once (this isolate)', async () => {
    await call('/api/public/bootstrap', { method: 'GET' });
    const res = await call('/api/sessions/manage', { token: gold, body: { action: 'update', slug: 'evening', active: false } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await call('/api/public/bootstrap', { method: 'GET' });
    expect(after.body.sessions.map((s) => s.slug)).toEqual(['morning']);
  });

  it('refuses writes', async () => {
    expect((await call('/api/public/bootstrap', { body: {} })).status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
const valid = (overrides = {}) => ({
  session: 'morning',
  phone: '+254712345678',
  studentName: 'Amina Wanjiru',
  class: 'Grade 8', // one of the session's (default) classes
  subjects: 'Mathematics',
  receiptMessage: 'QAB123XYZ9 Confirmed',
  ...overrides,
});
const register = (body, ip) => call('/api/student/register', { body, ip });

describe('POST /api/student/register (the rules-equivalent table)', () => {
  it('accepts a well-formed registration with the mandated initial state', async () => {
    const res = await register(valid());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.student).toMatchObject({ studentName: 'Amina Wanjiru', approvalStatus: 'pending', blocked: false });
    const doc = (await db.doc('sessions/morning/students/+254712345678').get()).data();
    expect(doc).toMatchObject({
      parentPhone: '+254712345678', session: 'morning', blocked: false,
      approvalStatus: 'pending', receiptStatus: 'pending', feeBalance: 0,
    });
    expect(doc.registeredAt).toBeTruthy();
  });

  // Every "denied shape" from tests/rules: the server takes no state fields at all.
  for (const [label, extra] of [
    ['self-approval', { approvalStatus: 'approved' }],
    ['pre-set blocked:false', { blocked: false }],
    ['a negative balance', { feeBalance: -5000 }],
    ['receiptStatus approved', { receiptStatus: 'approved' }],
    ['a smuggled field (mass assignment)', { studentUid: 'attacker-controlled' }],
    ['a separate parentPhone', { parentPhone: '+254798765432' }],
  ]) {
    it(`rejects ${label} with 400`, async () => {
      const res = await register(valid(extra));
      expect(res.status).toBe(400);
      expect((await db.doc('sessions/morning/students/+254712345678').get()).exists).toBe(false);
    });
  }

  for (const [label, overrides] of [
    ['a one-letter name', { studentName: 'A' }],
    ['a 101-character name', { studentName: `A${'a'.repeat(100)}` }],
    ['an empty class', { class: ' ' }],
    ['a 61-character class', { class: 'x'.repeat(61) }],
    ['two-letter subjects', { subjects: 'Ma' }],
    ['a short receipt', { receiptMessage: 'QAB1' }],
    ['a 501-character receipt', { receiptMessage: 'x'.repeat(501) }],
    ['a national trunk 0 after +254', { phone: '+254071234567' }],
    ['a phone without +', { phone: '0712345678' }],
  ]) {
    it(`rejects ${label} with 400`, async () => {
      expect((await register(valid(overrides))).status).toBe(400);
    });
  }

  it('refuses a hidden, unknown or reserved session (404)', async () => {
    expect((await register(valid({ session: 'hidden' }))).status).toBe(404);
    expect((await register(valid({ session: 'nowhere' }))).status).toBe(404);
    expect((await register(valid({ session: 'dashboard' }))).status).toBeGreaterThanOrEqual(400);
  });

  it('never overwrites an existing registration (409)', async () => {
    await register(valid());
    await db.doc('sessions/morning/students/+254712345678').set({ approvalStatus: 'approved' }, { merge: true });
    const again = await register(valid({ studentName: 'Someone Else' }));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_registered');
    const doc = (await db.doc('sessions/morning/students/+254712345678').get()).data();
    expect(doc).toMatchObject({ studentName: 'Amina Wanjiru', approvalStatus: 'approved' });
  });

  it('limits attempts per phone number (6th within the hour → 429), whatever the IP', async () => {
    let last;
    for (let i = 0; i < 6; i += 1) last = await register(valid(), `10.66.0.${i}`);
    expect(last.status).toBe(429);
  });
});
