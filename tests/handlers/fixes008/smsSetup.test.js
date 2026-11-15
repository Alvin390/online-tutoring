import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
  fakes, resetFakes, externalCalls,
} from '../_worker.js';

/**
 * 008Fixes / 08 — SMS is locked until set up (owner HashBack answers 1–2):
 * the school name (the {{schoolName}} placeholder), then a test SMS to the
 * teacher's own phone; a test HashBack accepted unlocks. The school's one
 * setup, shared by every staff account.
 */

const TEACHER_PHONE = '+254716099001';
let db; let teacher; let other;
const sms = (token, body) => call('/api/messages/sms', { token, body });
const sends = () => externalCalls.filter((c) => c.url.startsWith('https://api.hashback.co.ke/sms/send'));

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx008-setup-teacher', teacherClaims.gold, { email: 'teacher@school.example' });
  other = await userWithClaims('fx008-setup-other', teacherClaims.gold, { email: 'other@school.example' });
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'sms.enabled': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening Session', active: true, classes: ['Form 3'] });
  await db.doc(`sessions/evening/students/+254716099100`).set({
    studentName: 'Kid', parentPhone: '+254716099100', class: 'Form 3', session: 'evening', approvalStatus: 'approved', blocked: false,
  });
});

describe('locked until set up', () => {
  it('preview, start and sendOne are refused before unlocking', async () => {
    for (const body of [
      { action: 'preview', template: 'Hi', filter: { type: 'all' } },
      { action: 'start', template: 'Hi', filter: { type: 'all' } },
      { action: 'sendOne', session: 'evening', phone: '+254716099100', template: 'Hi' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await sms(teacher, body);
      expect(res.status, body.action).toBe(409);
      expect(res.body.error.code).toBe('sms_locked');
    }
    expect(sends()).toHaveLength(0);
    expect((await sms(teacher, { action: 'setup' })).body.setup).toMatchObject({ unlocked: false, schoolName: '' });
  });
});

describe('setting up', () => {
  it('school name, test to her phone, unlock; the setup is shared by every staff account', async () => {
    const named = await sms(teacher, { action: 'saveSchoolName', schoolName: '  Focus   Online ’School’ ' });
    expect(named.body.setup.schoolName).toBe("Focus Online 'School'");

    const test = await sms(teacher, { action: 'sendTest', phone: TEACHER_PHONE });
    expect(test.status).toBe(200);
    expect(test.body).toEqual({ sent: true, phoneEnding: '001', sender: 'HASHBACKSMS' });
    expect(sends()[0].body).toEqual({ to: TEACHER_PHONE, message: "Test from Focus Online 'School': SMS is working." });

    const unlocked = await sms(teacher, { action: 'unlock' });
    expect(unlocked.body.setup).toMatchObject({ unlocked: true, unlockedByEmail: 'teacher@school.example', sender: 'HASHBACKSMS', lastTestEnding: '001' });
    // The other account is unlocked too, and sends with the school name.
    expect((await sms(other, { action: 'setup' })).body.setup.unlocked).toBe(true);
    const preview = await sms(other, { action: 'preview', template: '{{schoolName}}: class at 7.', filter: { type: 'all' } });
    expect(preview.body.sample[0].text).toBe("Focus Online 'School': class at 7.");
  });

  it('unlock needs a test first; a name with emoji is refused; renaming later keeps it unlocked', async () => {
    expect((await sms(teacher, { action: 'unlock' })).body.error.code).toBe('test_first');
    expect((await sms(teacher, { action: 'saveSchoolName', schoolName: 'Focus 🌟' })).body.error.code).toBe('unsupported_characters');
    await sms(teacher, { action: 'sendTest', phone: TEACHER_PHONE });
    await sms(teacher, { action: 'unlock' });
    const renamed = await sms(teacher, { action: 'saveSchoolName', schoolName: 'Focus Academy' });
    expect(renamed.body.setup).toMatchObject({ unlocked: true, schoolName: 'Focus Academy' });
  });

  it('a test HashBack refuses does not count; no credit says so', async () => {
    fakes.hashback.fail = { code: 'INSUFFICIENT_FUNDS', status: 402 };
    const test = await sms(teacher, { action: 'sendTest', phone: TEACHER_PHONE });
    expect(test.status).toBe(402);
    expect(test.body.error.code).toBe('low_credit');
    expect((await sms(teacher, { action: 'unlock' })).body.error.code).toBe('test_first');
  });

  it('an old test (over an hour) does not unlock', async () => {
    await sms(teacher, { action: 'sendTest', phone: TEACHER_PHONE });
    await db.doc('config/smsSetup').set({ lastTestAt: new Date(Date.now() - 2 * 3600_000) }, { merge: true });
    expect((await sms(teacher, { action: 'unlock' })).body.error.code).toBe('test_first');
  });

  it('the setup is behind the SMS switch too', async () => {
    await setFlags(db, { 'sms.enabled': false });
    expect((await sms(teacher, { action: 'setup' })).body.error.code).toBe('sms_off');
  });
});
