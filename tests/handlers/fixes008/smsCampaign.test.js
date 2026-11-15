import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
  fakes, resetFakes, externalCalls, decodeGmailRaw,
} from '../_worker.js';

/**
 * 008Fixes / 07 — SMS through HashBack (the fake: nothing is sent or charged).
 * Every parent's own version is checked (two SMS at most, measured on the
 * longest, the student named; no emoji), one /sms/send per parent, chunks,
 * the KES 100 reserve, delivery reports on the every-minute job, the credit
 * alerts, sendOne, cancel, tiers and the flag.
 */

const P = (n) => `+2547160${String(10000 + n).padStart(5, '0')}`;
let db; let gold; let silver;
const sms = (token, body) => call('/api/messages/sms', { token, body });
const sends = () => externalCalls.filter((c) => c.url.startsWith('https://api.hashback.co.ke/sms/send'));
const mails = () => externalCalls.filter((c) => c.url.includes('gmail.googleapis.com')).map(decodeGmailRaw);

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims('fx008-sms-gold', teacherClaims.gold, { email: 'gold@school.example' });
  silver = await userWithClaims('fx008-sms-silver', teacherClaims.silver);
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Kid ${phone.slice(-3)}`, parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'x', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 550, ...extra,
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'sms.enabled': true, 'whatsapp.advanced': true, 'fees.enabled': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening Session', active: true, classes: ['Form 3', 'Grade 8'] });
  await db.doc('sessions/morning').set({ slug: 'morning', name: 'Morning Session', active: true, classes: ['Form 3'] });
  await db.doc('config/notifications').set({ reportRecipient: 'reports@school.example', smsAlertRecipient: 'owner@school.example' });
  // 008Fixes / 08: set up and unlocked (smsSetup.test.js covers the lock).
  await db.doc('config/smsSetup').set({ schoolName: 'Focus', unlockedAt: new Date() });
});

describe('the switch and the tiers', () => {
  it('off: refused', async () => {
    await setFlags(db, { 'sms.enabled': false });
    const res = await sms(gold, { action: 'preview', template: 'Hi', filter: { type: 'all' } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('sms_off');
  });

  it('Silver sends to everyone; choosing who is Gold', async () => {
    await seed('evening', P(1));
    expect((await sms(silver, { action: 'preview', template: 'Hi', filter: { type: 'all' } })).status).toBe(200);
    const filtered = await sms(silver, { action: 'preview', template: 'Hi', filter: { type: 'class', values: ['Form 3'] } });
    expect(filtered.status).toBe(403);
    expect(filtered.body.error.code).toBe('tier_required');
  });
});

describe('every parent\'s version is checked', () => {
  it('preview: the longest version and whose, units and cost; opt-outs, staff and unapproved left out', async () => {
    await seed('evening', P(1), { studentName: 'Ann' });
    await seed('evening', P(2), { studentName: 'Bartholomew Wekesa Omondi' });
    await seed('evening', P(3), { whatsappOptOut: true });
    await seed('evening', P(4), { staff: true });
    await seed('evening', P(5), { approvalStatus: 'pending' });
    const res = await sms(gold, { action: 'preview', template: 'Dear parent of {{studentName}}, class at 7.', filter: { type: 'all' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recipients: 2, units: 2, cost: 0.7, maxChars: 336, reserve: 100 });
    expect(res.body.longest.studentName).toBe('Bartholomew Wekesa Omondi');
  });

  it('over two SMS for the longest name: refused, naming that student', async () => {
    await seed('evening', P(1), { studentName: 'Ann' });
    await seed('evening', P(2), { studentName: 'Bartholomew Wekesa Omondi' });
    // 336 - 25 (the long name) + 11 ({{studentName}}) = 322 characters of text.
    const template = `${'a'.repeat(312)} {{studentName}}`;
    const res = await sms(gold, { action: 'preview', template, filter: { type: 'all' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('too_long');
    expect(res.body.error.message).toMatch(/Bartholomew Wekesa Omondi/);
  });

  it('emoji in the teacher\'s text: refused; curly quotes and long dashes are made plain', async () => {
    await seed('evening', P(1), { studentName: 'Ann' });
    const emoji = await sms(gold, { action: 'preview', template: 'Well done 😀', filter: { type: 'all' } });
    expect(emoji.status).toBe(400);
    expect(emoji.body.error.code).toBe('unsupported_characters');
    const curly = await sms(gold, { action: 'preview', template: '{{studentName}}’s class — 7 pm…', filter: { type: 'all' } });
    expect(curly.body.sample[0].text).toBe("Ann's class - 7 pm...");
  });

  it('a name in a decorative font is sent as plain letters', async () => {
    await seed('evening', P(1), { studentName: '𝑨𝒎𝒊𝒏𝒂 🌸' });
    const res = await sms(gold, { action: 'preview', template: 'Hi {{studentName}}', filter: { type: 'all' } });
    expect(res.body.sample[0].text).toBe('Hi Amina');
  });
});

describe('sending', () => {
  it('one /sms/send per parent with their own text; chunks of 20; then done', async () => {
    for (let i = 1; i <= 25; i += 1) await seed('evening', P(i), { studentName: `Kid ${i}` }); // eslint-disable-line no-await-in-loop
    const start = await sms(gold, { action: 'start', template: 'Hello {{studentName}}, class at 7. {{balance}}', filter: { type: 'all' } });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ recipients: 25, chunk: 20 });
    const first = await sms(gold, { action: 'sendChunk', campaignId: start.body.campaignId });
    expect(first.body).toMatchObject({ sent: 20, failed: 0, remaining: 5, done: false });
    const second = await sms(gold, { action: 'sendChunk', campaignId: start.body.campaignId });
    expect(second.body).toMatchObject({ sent: 5, remaining: 0, done: true });
    expect(sends()).toHaveLength(25);
    const toKid3 = sends().find((c) => c.body.to === P(3));
    expect(toKid3.body.message).toBe('Hello Kid 3, class at 7. KES 550');
    const got = await sms(gold, { action: 'get', campaignId: start.body.campaignId });
    expect(got.body.campaign).toMatchObject({ status: 'sent', counts: { queued: 0, sent: 25, delivered: 0, failed: 0 } });
    expect(got.body.recipients.every((r) => r.status === 'sent')).toBe(true);
    // Usage per teacher.
    const usage = (await db.doc('config/smsUsage').get()).data();
    expect(Object.values(usage.byTeacher)[0].units).toBe(25);
  });

  it("a full chunk of 20 stays inside the Worker's 45 subrequests", async () => {
    for (let i = 1; i <= 20; i += 1) await seed('evening', P(i)); // eslint-disable-line no-await-in-loop
    const start = await sms(gold, { action: 'start', template: 'Hi {{studentName}}', filter: { type: 'all' } });
    process.env.PERF_TIMING = '1';
    try {
      const chunk = await sms(gold, { action: 'sendChunk', campaignId: start.body.campaignId });
      expect(chunk.body.sent).toBe(20);
      const subreq = Number(/subreq;desc="(\d+)"/.exec(chunk.headers.get('server-timing'))[1]);
      expect(subreq).toBeLessThanOrEqual(45);
      console.log(`[p07] subrequests for a chunk of 20: ${subreq}`);
    } finally {
      delete process.env.PERF_TIMING;
    }
  });

  it('a number HashBack refuses is failed; HashBack busy pauses with retryAfter and the rest wait', async () => {
    for (let i = 1; i <= 3; i += 1) await seed('evening', P(i)); // eslint-disable-line no-await-in-loop
    fakes.hashback.failFor.set(P(2), { code: 'INVALID_NUMBER', status: 400 });
    const start = await sms(gold, { action: 'start', template: 'Hi', filter: { type: 'all' } });
    const r = await sms(gold, { action: 'sendChunk', campaignId: start.body.campaignId });
    expect(r.body).toMatchObject({ sent: 2, failed: 1, done: true });

    await seed('evening', P(4));
    const again = await sms(gold, { action: 'start', template: 'Again', filter: { type: 'all' } });
    fakes.hashback.fail = { code: 'RATE_LIMITED', status: 429, retryAfter: 20 };
    const busy = await sms(gold, { action: 'sendChunk', campaignId: again.body.campaignId });
    expect(busy.body).toMatchObject({ sent: 0, retryAfter: 20, done: false });
    expect(busy.body.remaining).toBe(4); // nothing went: all four wait for the next chunk
    fakes.hashback.fail = null;
    const after = await sms(gold, { action: 'sendChunk', campaignId: again.body.campaignId });
    expect(after.body.done).toBe(true);
  });

  it('two overlapping calls never send to the same parent twice', async () => {
    for (let i = 1; i <= 6; i += 1) await seed('evening', P(i)); // eslint-disable-line no-await-in-loop
    const start = await sms(gold, { action: 'start', template: 'Hi', filter: { type: 'all' } });
    await Promise.all([
      sms(gold, { action: 'sendChunk', campaignId: start.body.campaignId }),
      sms(gold, { action: 'sendChunk', campaignId: start.body.campaignId }),
    ]);
    await sms(gold, { action: 'sendChunk', campaignId: start.body.campaignId });
    const to = sends().map((c) => c.body.to);
    expect(new Set(to).size).toBe(to.length);
    expect(to).toHaveLength(6);
  });

  it('cancel: the rest are not sent', async () => {
    for (let i = 1; i <= 25; i += 1) await seed('evening', P(i)); // eslint-disable-line no-await-in-loop
    const start = await sms(gold, { action: 'start', template: 'Hi', filter: { type: 'all' } });
    await sms(gold, { action: 'sendChunk', campaignId: start.body.campaignId });
    const cancel = await sms(gold, { action: 'cancel', campaignId: start.body.campaignId });
    expect(cancel.body).toEqual({ cancelled: true, skipped: 5 });
    const after = await sms(gold, { action: 'sendChunk', campaignId: start.body.campaignId });
    expect(after.body.cancelled).toBe(true);
    expect(sends()).toHaveLength(20);
  });

  it('sendOne: a staff member by SMS; someone who opted out is refused', async () => {
    await seed('evening', P(1), { staff: true, studentName: 'Mwalimu Juma' });
    const one = await sms(gold, { action: 'sendOne', session: 'evening', phone: P(1), template: 'Hello {{studentName}}, meeting at 6.' });
    expect(one.status).toBe(200);
    expect(sends()[0].body).toEqual({ to: P(1), message: 'Hello Mwalimu Juma, meeting at 6.' });
    await seed('evening', P(2), { whatsappOptOut: true });
    expect((await sms(gold, { action: 'sendOne', session: 'evening', phone: P(2), template: 'Hi' })).body.error.code).toBe('opted_out');
  });
});

describe('who can be messaged (Phase 09)', () => {
  it('students and staff, opted-out and unapproved left out, with what the counter needs', async () => {
    await seed('evening', P(1), { studentName: 'Ann', feeBalance: 2750 });
    await seed('evening', P(2), { staff: true, studentName: 'Mwalimu Juma' });
    await seed('evening', P(3), { whatsappOptOut: true });
    await seed('morning', P(4), { approvalStatus: 'pending' });
    const res = await sms(silver, { action: 'people' });
    expect(res.status).toBe(200);
    expect(res.body.students).toEqual([expect.objectContaining({ phone: P(1), studentName: 'Ann', session: 'evening', sessionName: 'Evening Session', feeBalance: 2750 })]);
    expect(res.body.staff.map((p) => p.studentName)).toEqual(['Mwalimu Juma']);
  });
});

describe('credit', () => {
  it('below the KES 100 reserve: refused and the owner emailed once; codes still go out', async () => {
    await seed('evening', P(1));
    await db.doc('config/smsBalance').set({ balance: 100.2, fullAt: 500 });
    const start = await sms(gold, { action: 'start', template: 'Hi', filter: { type: 'all' } });
    expect(start.status).toBe(402);
    expect(start.body.error.code).toBe('low_credit');
    expect(start.body.error.message).toMatch(/check-in codes keep working/);
    await sms(gold, { action: 'start', template: 'Hi', filter: { type: 'all' } });
    const reserveMails = mails().filter((m) => /SMS paused/.test(m));
    expect(reserveMails).toHaveLength(1);
    expect(reserveMails[0]).toMatch(/To: owner@school\.example/);
    // A check-in code is not held back by the reserve.
    await setFlags(db, { 'sms.enabled': true, 'auth.legacyStudentRead': true });
    const code = await call('/api/student/requestCode', { body: { session: 'evening', phone: P(1) } });
    expect(code.body.deliveryChannel).toBe('sms');
  });

  it('80% used: one email; a top-up re-arms; out of credit: an email', async () => {
    const { recordSmsBalance } = await import('../../../api/_lib/smsCredit.js');
    await recordSmsBalance(500, { db });
    await recordSmsBalance(150, { db }); // 70% used: nothing
    expect(mails()).toHaveLength(0);
    await recordSmsBalance(90, { db }); // 82%
    await recordSmsBalance(80, { db });
    expect(mails().filter((m) => /80|82|84/.test(m) && /used/.test(m))).toHaveLength(1);
    await recordSmsBalance(400, { db }); // a top-up: the new 100%
    const state = (await db.doc('config/smsBalance').get()).data();
    expect(state).toMatchObject({ fullAt: 400, alerted80At: null });
    const before = mails().length;
    await recordSmsBalance(0.2, { db });
    expect(mails().slice(before)).toHaveLength(1); // one email, not "80%" as well
    expect(mails().at(-1)).toMatch(/run out/);
  });
});

describe('delivery reports (no new cron)', () => {
  it('the every-minute job records delivered and failed; nothing pending: it does nothing', async () => {
    for (let i = 1; i <= 3; i += 1) await seed('evening', P(i)); // eslint-disable-line no-await-in-loop
    const start = await sms(gold, { action: 'start', template: 'Hi', filter: { type: 'all' } });
    await sms(gold, { action: 'sendChunk', campaignId: start.body.campaignId });
    const ids = fakes.hashback.sent.map((m) => m.id);
    fakes.hashback.statuses.set(ids[0], 'delivered');
    fakes.hashback.statuses.set(ids[1], 'failed');
    const run = await call('/api/cron/smsDeliverySweep', { headers: { authorization: 'Bearer test-cron-secret' } });
    expect(run.status).toBe(200);
    expect(run.body.checked).toBe(1);
    const got = await sms(gold, { action: 'get', campaignId: start.body.campaignId });
    expect(got.body.campaign.counts).toMatchObject({ sent: 1, delivered: 1, failed: 1 });
    const failed = got.body.recipients.find((r) => r.status === 'failed');
    expect(failed.refunded).toBe(true);

    fakes.hashback.statuses.set(ids[2], 'delivered');
    const refresh = await sms(gold, { action: 'refresh', campaignId: start.body.campaignId });
    expect(refresh.body.campaign.counts).toMatchObject({ sent: 0, delivered: 2, failed: 1 });
    await call('/api/cron/smsDeliverySweep', { headers: { authorization: 'Bearer test-cron-secret' } });
    const empty = await call('/api/cron/smsDeliverySweep', { headers: { authorization: 'Bearer test-cron-secret' } });
    expect(empty.body.checked).toBe(0);
  });

  it('after 30 minutes a message stops being checked', async () => {
    await db.doc('config/smsPending').set({ items: { old: Date.now() - 1000 } });
    const run = await call('/api/cron/smsDeliverySweep', { headers: { authorization: 'Bearer test-cron-secret' } });
    expect(run.body.checked).toBe(0);
    expect((await db.doc('config/smsPending').get()).data().items.old).toBeUndefined();
  });
});
