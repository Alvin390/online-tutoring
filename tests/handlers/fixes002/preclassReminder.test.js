import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, drainWaitUntil,
  externalCalls, fakes, resetFakes, decodeGmailRaw, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 002Fixes / 09 — through the real Worker, the emulator and the Gmail fake:
 * the ten-minute sweep emails before class while students wait; the owner
 * controls it from Superadmin → Notifications.
 */

let db;
const CRON = { authorization: 'Bearer test-cron-secret' };
const eat = (iso) => Date.parse(`${iso}+03:00`);
const ALERTS = 'class.alerts@harness.example';
const PHONES = ['+254700900001', '+254700900002', '+254700900003'];

const sweep = () => call('/api/cron/notificationsSweep', { headers: CRON });
const sends = () => externalCalls.filter((c) => c.url.startsWith('https://gmail.googleapis.com'));

/** A sent message: its headers and its decoded text and HTML parts. */
function readMail(callRecord) {
  const raw = decodeGmailRaw(callRecord);
  const header = (name) => new RegExp(`^${name}: (.*)$`, 'mi').exec(raw)?.[1] ?? null;
  const parts = raw.split(/\r?\n--alt_[^\r\n]*/).slice(1)
    .map((p) => p.split(/\r?\n\r?\n/).slice(1).join('\n').replace(/\s+/g, ''))
    .filter(Boolean)
    .map((b64) => { try { return Buffer.from(b64, 'base64').toString('utf8'); } catch { return ''; } });
  const subjectRaw = header('Subject') ?? '';
  const subject = subjectRaw.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8')).replace(/\s+/g, ' ');
  return { raw, header, subject, body: parts.join('\n') };
}

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  await setFlags(db, { 'registration.requireApproval': true, 'auth.legacyStudentRead': true });
  await db.doc('sessions/evening').set({
    slug: 'evening', name: 'Evening Session', active: true,
    schedule: { days: [], tz: 'Africa/Nairobi', startTime: '19:30', endTime: '21:30' },
  });
  await db.doc('config/notifications').set({ reportRecipient: 'owner@harness.example', classAlertRecipient: ALERTS });
  const kids = [['Amina Wanjiru', 'Form 3'], ['Brian Otieno', 'Form 3'], ['Chebet Kirui', 'Grade 8']];
  for (const [i, [studentName, cls]] of kids.entries()) {
    await db.doc(`sessions/evening/students/${PHONES[i]}`).set({ studentName, class: cls, approvalStatus: 'pending', blocked: false, parentPhone: PHONES[i] });
  }
  await db.doc('sessions/evening/students/+254700900009').set({ studentName: 'Approved Kid', class: 'Form 3', approvalStatus: 'approved' });
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => vi.useRealTimers());

const at = async (iso) => { vi.setSystemTime(eat(iso)); const res = await sweep(); await drainWaitUntil(); return res; };

describe('the sweep', () => {
  it('50 minutes before class with 3 waiting: one email, to the chosen address, counts only, automated notice, no Reply-To', async () => {
    const res = await at('2026-10-27T18:40');
    expect(res.status).toBe(200);
    expect(res.body.preclassSent).toBe(1);
    expect(sends()).toHaveLength(1);
    const mail = readMail(sends()[0]);
    expect(mail.header('To')).toBe(ALERTS);
    expect(mail.header('Reply-To')).toBeNull();
    expect(mail.subject).toBe('3 students waiting for approval — Evening Session at 7:30 PM');
    expect(mail.body).toContain('This is an automated email from Online Tutoring. Please do not reply to it — replies are not read.');
    expect(mail.body).toMatch(/Form 3: 2/);
    expect(mail.body).toMatch(/Grade 8: 1/);
    expect(mail.body).toContain('https://validation.example/dashboard');
    for (const secret of ['Amina', 'Brian', 'Chebet', 'Approved Kid', '700900001', '700900002', '700900003']) {
      expect(mail.raw + mail.body).not.toContain(secret);
    }
  });

  it('at most once per reminder: the next run in the same window sends nothing', async () => {
    await at('2026-10-27T18:40');
    await at('2026-10-27T18:50');
    await at('2026-10-27T19:00');
    expect(sends()).toHaveLength(1);
  });

  it('the 15-minute reminder goes if anyone is still waiting', async () => {
    await at('2026-10-27T18:40');
    await db.doc(`sessions/evening/students/${PHONES[0]}`).set({ approvalStatus: 'approved' }, { merge: true });
    await db.doc(`sessions/evening/students/${PHONES[1]}`).set({ approvalStatus: 'approved' }, { merge: true });
    await at('2026-10-27T19:20');
    expect(sends()).toHaveLength(2);
    expect(readMail(sends()[1]).subject).toBe('1 student waiting for approval — Evening Session at 7:30 PM');
  });

  it('nobody waiting: no email', async () => {
    for (const p of PHONES) await db.doc(`sessions/evening/students/${p}`).set({ approvalStatus: 'approved' }, { merge: true });
    await at('2026-10-27T18:40');
    await at('2026-10-27T19:20');
    expect(sends()).toHaveLength(0);
  });

  it('more than an hour before, or after the start: no email', async () => {
    await at('2026-10-27T18:20');
    await at('2026-10-27T19:35');
    expect(sends()).toHaveLength(0);
  });

  it('off in Superadmin → no email; approval off → no email', async () => {
    await db.doc('config/notifications').set({ classAlertsEnabled: false }, { merge: true });
    await at('2026-10-27T18:40');
    expect(sends()).toHaveLength(0);
    await db.doc('config/notifications').set({ classAlertsEnabled: true }, { merge: true });
    await setFlags(db, { 'registration.requireApproval': false, 'auth.legacyStudentRead': true });
    await new Promise((r) => { setTimeout(r, 0); });
    vi.setSystemTime(eat('2026-10-27T18:40') + 40_000); // past the 30 s flag cache
    await sweep();
    expect(sends()).toHaveLength(0);
  });

  it('a failed send is retried by the next run in the same window', async () => {
    fakes.gmail.fail = 500;
    await at('2026-10-27T18:40');
    expect((await db.collection('notificationMarks').get()).size).toBe(0);
    fakes.gmail.fail = null;
    const before = sends().length;
    await at('2026-10-27T18:50');
    expect(sends().length).toBe(before + 1);
  });

  it('markers older than a week are purged', async () => {
    await db.doc('notificationMarks/preclass_evening_2026-10-01_60').set({ session: 'evening', reminder: '60', createdAt: new Date(eat('2026-10-01T18:40')) });
    await at('2026-10-27T12:00');
    expect((await db.doc('notificationMarks/preclass_evening_2026-10-01_60').get()).exists).toBe(false);
  });
});

describe('Superadmin → Notifications', () => {
  let superadmin;
  beforeEach(async () => {
    vi.useRealTimers(); // a real clock for the auth emulator's tokens
    superadmin = await userWithClaims('fx002-superadmin', teacherClaims.superadmin);
  });
  const notifications = (body, token = superadmin) => call('/api/admin/notifications', { body, token });

  it('get: on, and where it goes and why', async () => {
    const res = await notifications({ action: 'get' });
    expect(res.status).toBe(200);
    expect(res.body.classAlerts).toEqual({ enabled: true, recipient: ALERTS, recipients: [ALERTS], source: 'set' });
  });

  it('change the address (audited), reset it to the default, and turn reminders off and on', async () => {
    const set = await notifications({ action: 'setClassAlertRecipient', email: 'New.Address@Harness.example' });
    expect(set.body.classAlerts).toMatchObject({ recipient: 'new.address@harness.example', source: 'set' });
    expect((await db.doc('config/notifications').get()).data().classAlertRecipient).toBe('new.address@harness.example');

    const reset = await notifications({ action: 'resetClassAlertRecipient' });
    expect(reset.body.classAlerts.recipient).toBeNull();
    expect(['teacher', 'report']).toContain(reset.body.classAlerts.source);
    expect((await db.doc('config/notifications').get()).data().classAlertRecipient).toBeUndefined();

    const off = await notifications({ action: 'setClassAlertsEnabled', enabled: false });
    expect(off.body.classAlerts.enabled).toBe(false);
    expect((await db.doc('config/notifications').get()).data().classAlertsEnabled).toBe(false);
    expect((await notifications({ action: 'setClassAlertsEnabled', enabled: true })).body.classAlerts.enabled).toBe(true);

    await drainWaitUntil();
    const audits = (await db.collection('audit').get()).docs.map((d) => d.data().action);
    expect(audits.filter((a) => a === 'notifications.class_alert_recipient_changed')).toHaveLength(2);
    expect(audits.filter((a) => a === 'notifications.class_alerts_toggled')).toHaveLength(2);
  });

  it('a bad address is refused', async () => {
    const res = await notifications({ action: 'setClassAlertRecipient', email: 'not-an-address' });
    expect(res.status).toBe(400);
  });

  it('send a test reminder: marked as a test, with the automated notice, to the current address', async () => {
    const res = await notifications({ action: 'sendClassAlertTest' });
    expect(res.body).toMatchObject({ sent: true });
    const mail = readMail(sends().at(-1));
    expect(mail.header('To')).toBe(ALERTS);
    expect(mail.subject.startsWith('[Test] ')).toBe(true);
    expect(mail.body).toContain('Please do not reply to it');
  });

  it('a teacher cannot change it', async () => {
    const teacher = await userWithClaims('fx002-teacher', teacherClaims.gold);
    const res = await notifications({ action: 'setClassAlertRecipient', email: 'x@harness.example' }, teacher);
    expect(res.status).toBe(403);
  });
});
