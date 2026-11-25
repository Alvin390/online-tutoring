import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
  fakes, externalCalls, decodeGmailRaw,
} from '../_worker.js';

/**
 * 013Fixes / 23 — reminder emails (owner suggestion 7). The hourly sweep
 * queues the step that is due and sends what is queued through Gmail: to the
 * school owner's login email, with a copy to the owner's notification
 * address. Sent once; a failure is tried again next hour, 3 tries in all; a
 * card school only after a failed payment; no address ever in the logs.
 */

const D = 86_400_000;
const H = 3_600_000;
const OWNER_EMAIL = 'fx013-rem-owner@harness.example';
const COPY_EMAIL = 'owner-copy@harness.example';
let db;
let logs;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  await userWithClaims('fx013-rem-owner', teacherClaims.gold, { email: OWNER_EMAIL });
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
  (await import('../../../api/_lib/billingSettings.js')).__resetBillingSettingsCache();
  await setFlags(db, { 'billing.enabled': true });
  await db.doc('config/notifications').set({ reportRecipient: COPY_EMAIL });
  logs = [];
  for (const level of ['log', 'warn', 'error']) {
    vi.spyOn(console, level).mockImplementation((line) => { logs.push(String(line)); });
  }
});
afterEach(() => vi.restoreAllMocks());

const sweep = () => call('/api/cron/subscriptionSweep', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: {} });
const sends = () => externalCalls.filter((c) => String(c.url).includes('gmail.googleapis.com'));
const queue = async () => (await db.collection('billing/reminders/queue').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const sub = async () => (await db.doc('subscription/current').get()).data();
const manual = (end, extra = {}) => db.doc('subscription/current').set({
  tier: 'silver', status: 'active', renewalMode: 'manual', ownerUid: 'fx013-rem-owner',
  currentPeriodStart: new Date(end - 30 * D), currentPeriodEnd: new Date(end), ...extra,
});

describe('a reminder is sent once', () => {
  it('3 days out: queued, sent to the owner with a copy, marked; the next run sends nothing', async () => {
    await manual(Date.now() + 2.5 * D);
    expect((await sweep()).status).toBe(200);
    const [q] = await queue();
    expect(q).toMatchObject({ reminderId: 'days_3', kind: 'period', status: 'sent', attempts: 1 });
    expect(sends()).toHaveLength(1);
    const mail = decodeGmailRaw(sends()[0]);
    expect(mail).toMatch(new RegExp(`^To: ${OWNER_EMAIL}\\s*$`, 'm'));
    expect(mail).toMatch(new RegExp(`^Cc: ${COPY_EMAIL}\\s*$`, 'm'));
    expect(mail).toMatch(/Subject: Your plan ends in 3 days/);
    expect((await sub()).remindersSent).toEqual(['days_3']);
    await sweep();
    expect(sends()).toHaveLength(1);
    expect(logs.join('\n')).not.toMatch(/@harness\.example/);
  });

  it('two steps due at once (a release mid-ladder): one email, the most urgent; both marked', async () => {
    await manual(Date.now() + 12 * H);
    await sweep();
    expect(sends()).toHaveLength(1);
    expect(decodeGmailRaw(sends()[0])).toMatch(/Subject: Your plan ends tomorrow/);
    expect((await sub()).remindersSent.sort()).toEqual(['days_1', 'days_3']);
    expect((await queue()).map((q) => q.reminderId)).toEqual(['days_1']);
  });

  it('at lock: the email says the account is locked', async () => {
    await manual(Date.now() - H, { remindersSent: ['days_3', 'days_1'] });
    await sweep();
    expect((await sub()).status).toBe('locked');
    expect(decodeGmailRaw(sends()[0])).toMatch(/Subject: Your account is locked/);
  });
});

describe('failures', () => {
  it('tried again each hour, 3 tries in all, then left for a person', async () => {
    await manual(Date.now() + 2.5 * D);
    fakes.gmail.fail = 500;
    await sweep();
    expect((await queue())[0]).toMatchObject({ status: 'failed', attempts: 1 });
    await sweep();
    await sweep();
    expect((await queue())[0]).toMatchObject({ status: 'gave_up', attempts: 3 });
    const tries = sends().length;
    await sweep();
    expect(sends()).toHaveLength(tries);
    expect(logs.join('\n')).not.toMatch(/@harness\.example/);
  });

  it('a queued reminder past its time is not sent late', async () => {
    const end = Date.now() - 3 * D;
    await manual(end, { status: 'locked', remindersSent: ['days_3', 'days_1', 'at_lock'] });
    await db.doc(`billing/reminders/queue/days_1_${end}`).set({ reminderId: 'days_1', kind: 'period', tier: 'silver', endsAt: new Date(end), status: 'queued', attempts: 0, queuedAt: new Date(end - D) });
    await sweep();
    expect(sends()).toHaveLength(0);
    expect((await queue())[0].status).toBe('stale');
  });
});

describe('who gets one', () => {
  it('a card school renewing by itself: none', async () => {
    await manual(Date.now() + 12 * H, { renewalMode: 'auto', paystackSubscriptionCode: 'SUB_x' });
    await sweep();
    expect(await queue()).toEqual([]);
    expect(sends()).toHaveLength(0);
  });

  it('a card school whose payment failed: the ladder, as a failed card payment', async () => {
    await manual(Date.now() + 12 * H, { renewalMode: 'auto', paystackSubscriptionCode: 'SUB_x', paymentFailedAt: new Date() });
    await sweep();
    const [q] = await queue();
    expect(q).toMatchObject({ kind: 'card_failed', status: 'sent' });
    expect(decodeGmailRaw(sends()[0])).toMatch(/Subject: Your card payment did not go through/);
  });

  it('no owner login: the copy still goes to the notification address', async () => {
    await manual(Date.now() + 2.5 * D, { ownerUid: null });
    await sweep();
    const mail = decodeGmailRaw(sends()[0]);
    expect(mail).toMatch(new RegExp(`^To: ${COPY_EMAIL}\\s*$`, 'm'));
    expect(mail).not.toMatch(/^Cc:/m);
  });
});
