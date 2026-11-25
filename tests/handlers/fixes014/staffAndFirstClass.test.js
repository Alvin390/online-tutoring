import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, fakes, resetFakes,
} from '../_worker.js';

/**
 * 014Fixes / 07 — staff end to end (owner ruling 11: the same box and flow,
 * S- numbers), and the first class after the switch-on: about 40
 * first-timers behind ONE carrier address (26 Oct: 34 check-ins from one).
 * The plan asks 2x headroom, so 80 go phone → code → number given → in with
 * no one refused for the address's hourly limits (160 check-ins: over the
 * old 120).
 */

const P = (n) => `+2547144${String(10000 + n).padStart(5, '0')}`;
const DEV = (n) => `device014F${String(n).padStart(24, '0')}`;
const codeFor = (phone) => {
  const sms = [...fakes.hashback.sent].reverse().find((m) => m.to === phone && /Your code is \d{6}\./.test(m.message));
  return /Your code is (\d{6})\./.exec(sms?.message ?? '')?.[1] ?? null;
};
let db;

const seed = (phone, extra = {}) => db.doc(`sessions/evening/students/${phone}`).set({
  studentName: `Student ${phone.slice(-3)}`, parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'Paid by M-Pesa QWE123', registeredAt: new Date('2026-10-01T06:00:00Z'), session: 'evening',
  blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});

/** The whole first time, from `ip`: phone → code → number given → in. Returns the last answer. */
async function firstTime(phone, ip, device) {
  const checkin = (number) => call('/api/student/checkin', { ip, body: { session: 'evening', phone, deviceId: device, ...(number ? { number } : {}) } });
  const first = await checkin();
  if (first.body?.error?.code !== 'verify_required') return { step: 'checkin', res: first };
  const asked = await call('/api/student/requestCode', { ip, body: { session: 'evening', phone } });
  if (asked.status !== 200) return { step: 'requestCode', res: asked };
  const verified = await call('/api/student/verifyCode', { ip, body: { session: 'evening', phone, code: codeFor(phone) } });
  if (verified.status !== 200) return { step: 'verifyCode', res: verified };
  const given = await call('/api/student/number', { ip, body: { action: 'assign', session: 'evening', phone, ticket: verified.body.ticket } });
  if (given.status !== 200) return { step: 'assign', res: given };
  const inside = await checkin(given.body.display);
  return { step: 'in', res: inside, given: given.body };
}

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true, classes: ['Form 3'] });
});

describe('staff', () => {
  it('phone → code → a staff number given (S-) → in with S-; the digits alone do not match', async () => {
    await seed(P(1), { staff: true });
    const out = await firstTime(P(1), '198.51.100.31', DEV(1));
    expect(out.step, JSON.stringify(out.res.body)).toBe('in');
    expect(out.given).toMatchObject({ kind: 'staff' });
    expect(out.given.display).toBe(`S-${out.given.number}`);
    expect(out.res.status).toBe(200);
    const digitsOnly = await call('/api/student/checkin', { body: { session: 'evening', phone: P(1), deviceId: DEV(1), number: out.given.number } });
    expect(digitsOnly.body.error.code).toBe('number_mismatch');
  });
});

describe('the first class after the switch-on', () => {
  it('80 first-timers (2x the expected 40) behind one address all get in; none is refused for the address', { timeout: 600_000 }, async () => {
    const ip = '198.51.100.40';
    const phones = Array.from({ length: 80 }, (_, i) => P(100 + i));
    for (const p of phones) await seed(p); // eslint-disable-line no-await-in-loop
    const outcomes = [];
    for (const [i, p] of phones.entries()) outcomes.push(await firstTime(p, ip, DEV(100 + i))); // eslint-disable-line no-await-in-loop
    const stuck = outcomes.filter((o) => o.step !== 'in' || o.res.status !== 200);
    expect(stuck.map((o) => `${o.step} ${o.res.status} ${o.res.body?.error?.code}`)).toEqual([]);
    expect(new Set(outcomes.map((o) => o.given.number)).size).toBe(80);
  });
});
