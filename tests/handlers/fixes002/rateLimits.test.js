import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 002Fixes / 06 — limits that cannot lock a student out of class.
 *
 *   check-in, per phone   20 / hour  → 20 / 10 minutes
 *   check-in, per IP      30 / hour  → 120 / hour
 *   class link, per IP    20 / hour  → 120 / hour
 *
 * Only Date is faked (the emulator needs real timers), to step across windows.
 */

let db;
const T0 = Date.parse('2026-10-27T16:30:01Z'); // 1 s into a 10-minute (and an hour) window

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
});

beforeEach(async () => {
  await clearFirestore();
  await setFlags(db, { 'auth.legacyStudentRead': true });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => vi.useRealTimers());

const checkin = (phone, ip, token) => call('/api/student/checkin', { body: { session: 'evening', phone }, ip, token });

describe('per phone: 20 per 10 minutes', () => {
  it('the 21st within ten minutes is refused, with a wait of at most ten minutes', async () => {
    const phone = phoneN(7001);
    for (let i = 0; i < 20; i += 1) expect((await checkin(phone, `10.60.0.${i}`)).status).toBe(200);
    const refused = await checkin(phone, '10.60.0.99');
    expect(refused.status).toBe(429);
    const wait = Number(refused.headers.get('retry-after'));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(600);
  });

  it('ten minutes later the same number is let in again (it used to be the top of the hour)', async () => {
    const phone = phoneN(7002);
    for (let i = 0; i < 21; i += 1) await checkin(phone, `10.61.0.${i}`);
    vi.setSystemTime(T0 + 600_000);
    expect((await checkin(phone, '10.61.1.1')).status).toBe(200);
  });

  it('a teacher is never phone-limited (unchanged)', async () => {
    vi.useRealTimers(); // a real clock for the auth emulator's token
    const token = await userWithClaims('fx002-rl-teacher', teacherClaims.gold);
    const phone = phoneN(7003);
    let last;
    for (let i = 0; i < 25; i += 1) last = await checkin(phone, `10.62.0.${i}`, token);
    expect(last.status).toBe(200);
  });
});

describe('per IP: 120 per hour', () => {
  it('check-in: 120 different numbers from one address are fine; the 121st is refused', async () => {
    const ip = '198.51.100.120';
    for (let i = 0; i < 120; i += 1) {
      const res = await checkin(phoneN(8000 + i), ip);
      expect(res.status, `request ${i + 1}`).toBe(200);
    }
    const refused = await checkin(phoneN(8999), ip);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeLessThanOrEqual(3600);
  });

  it('class link: 120 from one address are not rate-limited; the 121st is', async () => {
    const ip = '198.51.100.121';
    for (let i = 0; i < 120; i += 1) {
      const res = await call('/api/class/link', { body: { session: 'evening', phone: phoneN(9000 + i) }, ip });
      expect(res.status, `request ${i + 1}`).not.toBe(429);
    }
    const refused = await call('/api/class/link', { body: { session: 'evening', phone: phoneN(9999) }, ip });
    expect(refused.status).toBe(429);
  });
});
