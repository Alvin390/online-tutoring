import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN } from '../_worker.js';

/**
 * 002Fixes / 02 — through the real Worker: a rejected check-in's log line
 * carries the value's shape or the limiter that refused, the response is
 * exactly what it was, and no phone number reaches the log.
 */

let db;
let warnings;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
});

beforeEach(async () => {
  await clearFirestore();
  await setFlags(db, { 'auth.legacyStudentRead': true });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true });
  warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const rejections = () => warnings.mock.calls
  .map(([line]) => { try { return JSON.parse(line); } catch { return null; } })
  .filter((l) => l?.msg?.startsWith('Request rejected'));

describe('validation failures', () => {
  it('an empty phone: same 400 as before, and the log says field phone, kind empty', async () => {
    const res = await call('/api/student/checkin', { body: { session: 'evening', phone: '' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'validation_failed', message: 'phone: must be a valid international phone number, e.g. +254712345678' } });
    expect(rejections().at(-1).meta.detail).toEqual({ field: 'phone', issue: 'invalid_format', kind: 'empty', len: 0 });
  });

  it('a trunk-zero number is logged as trunk0, without its digits', async () => {
    const res = await call('/api/student/checkin', { body: { session: 'evening', phone: '+2540798765432' } });
    expect(res.status).toBe(400);
    const line = rejections().at(-1);
    expect(line.meta.detail).toMatchObject({ field: 'phone', kind: 'string', plus: true, digits: 13, trunk0: true });
    expect(JSON.stringify(line)).not.toContain('98765432');
  });
});

describe('rate-limit refusals say which limiter refused', () => {
  it('the per-phone limiter', async () => {
    const phone = phoneN(4242);
    let res;
    for (let i = 0; i < 21; i += 1) {
      res = await call('/api/student/checkin', { body: { session: 'evening', phone } });
    }
    expect(res.status).toBe(429);
    const detail = rejections().at(-1).meta.detail;
    expect(detail).toMatchObject({ bucket: 'student_checkin_phone', limit: 20 });
    expect(detail.retryAfter).toBeGreaterThan(0);
    expect(JSON.stringify(rejections())).not.toContain(phone.slice(1));
  });

  it('the per-IP limiter', async () => {
    const ip = '198.51.100.77';
    let res;
    for (let i = 0; i < 31; i += 1) {
      res = await call('/api/student/checkin', { ip, body: { session: 'evening', phone: phoneN(5000 + i) } });
    }
    expect(res.status).toBe(429);
    expect(rejections().at(-1).meta.detail).toMatchObject({ bucket: 'student_checkin', limit: 30 });
    expect(JSON.stringify(rejections())).not.toContain(ip);
  });
});
