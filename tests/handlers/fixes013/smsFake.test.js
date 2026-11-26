import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, seedPlan, resetFakes,
  externalCalls, drainWaitUntil,
} from '../_worker.js';

/**
 * 013Fixes / 33b — the SMS switch (owner answer 4): real or fake, from
 * Superadmin → Settings → Modes, in config/mode, with SMS_MODE as the
 * fallback and "real" as the default (today).
 *
 * Fake = no call to HashBack; messages are recorded as fake and use no SMS
 * units (no reservation, no wallet check). Where a real person waits for the
 * SMS, fake mode takes the existing "not sent" route instead of pretending:
 *   - a check-in code is read out by the teacher (deliveryChannel 'teacher');
 *   - the teacher's test SMS is refused (a fake test must not unlock sending);
 *   - the admission-number SMS is skipped.
 * The delivery check never asks HashBack about a fake message.
 */

const P = (n) => `+2547180${String(10000 + n).padStart(5, '0')}`;
let db; let admin; let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013-smsfake-admin', teacherClaims.superadmin);
  teacher = await userWithClaims('fx013-smsfake-teacher', { role: 'teacher' });
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  resetFakes();
  await setFlags(db, { 'sms.enabled': true, 'fees.enabled': true });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true, classes: ['Form 3'] });
  await db.doc('config/smsSetup').set({ schoolName: 'Focus', unlockedAt: new Date() });
  await db.doc('config/notifications').set({ reportRecipient: 'reports@school.example' });
  await seedPlan(db, 'gold', { currentPeriodStart: new Date(Date.now() - 86_400_000) });
  await db.doc('config/plans').set({ gold: { limits: { smsUnits: 2 } } });
  (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
});

const modes = (body, token = admin) => call('/api/admin/modes', { token, body });
const fake = () => modes({ action: 'setSms', mode: 'fake' });
const sms = (body) => call('/api/messages/sms', { token: teacher, body });
const hashback = (path) => externalCalls.filter((c) => String(c.url).includes('hashback') && (!path || String(c.url).includes(path)));
const seed = (phone) => db.doc(`sessions/evening/students/${phone}`).set({
  studentName: 'Kid', parentPhone: phone, class: 'Form 3', subjects: 'English', session: 'evening',
  registeredAt: new Date('2026-10-01T06:00:00Z'), blocked: false, approvalStatus: 'approved', feeBalance: 0,
});
const credits = async () => (await db.doc('sms/credits').get()).data() ?? {};

async function sendAll(campaignId) {
  for (let i = 0; i < 10; i += 1) {
    const r = await sms({ action: 'sendChunk', campaignId }); // eslint-disable-line no-await-in-loop
    if (r.status !== 200 || r.body.done || r.body.retryAfter) return r;
  }
  return null;
}

describe('the SMS switch', () => {
  it('real by default; fake is chosen, audited, and the bootstrap says so', async () => {
    let res = await modes({ action: 'status' });
    expect(res.body.sms).toMatchObject({ mode: 'real', source: 'env' });
    res = await fake();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.sms).toMatchObject({ mode: 'fake', source: 'setting' });
    await drainWaitUntil();
    const [a] = (await db.collection('audit').where('action', '==', 'mode.sms_changed').get()).docs.map((d) => d.data());
    expect(a).toMatchObject({ before: { mode: 'real' }, after: { mode: 'fake' } });
    expect((await call('/api/public/bootstrap', { method: 'GET' })).body.modes).toMatchObject({ smsFake: true });
  });

  it('superadmin only', async () => {
    expect((await modes({ action: 'setSms', mode: 'fake' }, teacher)).status).toBe(403);
  });
});

describe('fake: nothing reaches HashBack, and no units are used', () => {
  it('a campaign: every message recorded as sent and fake; delivered without asking HashBack; units untouched', async () => {
    for (const n of [1, 2, 3]) await seed(P(n)); // 3 units wanted, only 2 included: fake needs none
    await fake();
    const started = await sms({ action: 'start', template: 'Hi', filter: { type: 'all' } });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const last = await sendAll(started.body.campaignId);
    expect(last.status, JSON.stringify(last.body)).toBe(200);
    expect(hashback('/send')).toHaveLength(0);
    const recipients = (await db.collection(`sms/campaigns/items/${started.body.campaignId}/recipients`).get()).docs.map((d) => d.data());
    expect(recipients).toHaveLength(3);
    expect(recipients.every((r) => r.status === 'sent' && r.fake === true && /^fake_/.test(r.smsId))).toBe(true);
    expect((await credits()).includedUsed ?? 0).toBe(0);
    const refresh = await sms({ action: 'refresh', campaignId: started.body.campaignId });
    expect(refresh.status, JSON.stringify(refresh.body)).toBe(200);
    expect(hashback('/status')).toHaveLength(0);
    const after = (await db.collection(`sms/campaigns/items/${started.body.campaignId}/recipients`).get()).docs.map((d) => d.data());
    expect(after.every((r) => r.status === 'delivered')).toBe(true);
  });

  it('one message: sent as fake, no units', async () => {
    await seed(P(5));
    await fake();
    const res = await sms({ action: 'sendOne', session: 'evening', phone: P(5), template: 'Hello' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(hashback('/send')).toHaveLength(0);
    expect((await credits()).includedUsed ?? 0).toBe(0);
  });

  it('the teacher\'s test SMS is refused (it must not unlock real sending)', async () => {
    await fake();
    const res = await sms({ action: 'sendTest', phone: P(6) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('sms_fake');
    expect(hashback('/send')).toHaveLength(0);
    expect((await db.doc('config/smsSetup').get()).data().lastTestId ?? null).toBeNull();
  });

  it('a check-in code: not sent; the teacher reads it out (as when SMS is unavailable)', async () => {
    await setFlags(db, { 'sms.enabled': true, 'fees.enabled': true, 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true });
    await fake();
    await seed(P(7));
    const res = await call('/api/student/requestCode', { body: { session: 'evening', phone: P(7) } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.deliveryChannel).toBe('teacher');
    expect(hashback('/send')).toHaveLength(0);
  });

  it('back to real: HashBack again', async () => {
    await seed(P(8));
    await fake();
    await modes({ action: 'setSms', mode: 'real' });
    const res = await sms({ action: 'sendOne', session: 'evening', phone: P(8), template: 'Hello' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(hashback('/send')).toHaveLength(1);
  });
});
