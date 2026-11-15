import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import process from 'node:process';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
  fakes, resetFakes, externalCalls,
} from '../_worker.js';

/**
 * 008Fixes / 10 — the superadmin SMS card (owner answers 6 and 8: track the
 * spend; alerts at 80% and at no credit; no cap). Superadmin only.
 */

let db; let admin; let teacher;
const adminSms = (token, body) => call('/api/admin/sms', { token, body });
const sms = (token, body) => call('/api/messages/sms', { token, body });
const balanceCalls = () => externalCalls.filter((c) => c.url.startsWith('https://api.hashback.co.ke/sms/balance'));

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx008-admin-sms', teacherClaims.superadmin, { email: 'sms-cost-owner@school.example' });
  teacher = await userWithClaims('fx008-admin-teacher', teacherClaims.gold, { email: 'sms-cost-teacher@school.example' });
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  externalCalls.length = 0;
  await setFlags(db, { 'sms.enabled': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  await db.doc('config/notifications').set({ reportRecipient: 'reports@school.example' });
});

describe('who may', () => {
  it('superadmin only', async () => {
    expect((await adminSms(teacher, { action: 'summary' })).status).toBe(403);
    expect((await adminSms(null, { action: 'summary' })).status).toBe(401);
    expect((await adminSms(admin, { action: 'summary' })).status).toBe(200);
  });
});

describe('summary', () => {
  it('nothing recorded yet: no balance, no usage, alerts go to the report recipient', async () => {
    const res = await adminSms(admin, { action: 'summary' });
    expect(res.body).toMatchObject({
      balance: null, usage: [], totals: { cost: 0 }, setup: { unlocked: false },
      alerts: { recipient: 'reports@school.example', source: 'report', usedThreshold: 0.8 }, rate: 0.35, reserve: 100,
    });
  });

  it('after a send: the balance, a top-up noticed, and the teacher by email this month and in total', async () => {
    await db.doc('config/smsSetup').set({ schoolName: 'Focus', unlockedAt: new Date(), unlockedByEmail: 'sms-cost-teacher@school.example' });
    await db.doc('config/smsBalance').set({ balance: 150, fullAt: 150 }); // above the KES 100 reserve
    await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening Session', active: true, classes: ['Form 3'] });
    await db.doc('sessions/evening/students/+254716099200').set({
      studentName: 'Kid', parentPhone: '+254716099200', class: 'Form 3', session: 'evening', approvalStatus: 'approved', blocked: false,
    });
    // HashBack's wallet was topped up to 400; the send's reply (399.65) is a rise.
    fakes.hashback.balance = 400;
    const sent = await sms(teacher, { action: 'sendOne', session: 'evening', phone: '+254716099200', template: 'Hello {{studentName}}' });
    expect(sent.status).toBe(200);
    const res = await adminSms(admin, { action: 'summary' });
    expect(res.body.balance).toMatchObject({ balance: 399.65, units: 1141, fullAt: 399.65 });
    expect(res.body.balance.topUpAt).toBeTruthy();
    expect(res.body.usage).toEqual([expect.objectContaining({ email: 'sms-cost-teacher@school.example', units: 1, cost: 0.35, monthUnits: 1, monthCost: 0.35 })]);
    expect(res.body.totals).toEqual({ monthUnits: 1, monthCost: 0.35, units: 1, cost: 0.35 });
    expect(res.body.setup).toMatchObject({ unlocked: true, schoolName: 'Focus', unlockedByEmail: 'sms-cost-teacher@school.example' });
  });

  it('the alerts sent show with their time', async () => {
    const at = new Date('2026-11-20T08:00:00Z');
    await db.doc('config/smsBalance').set({ balance: 50, fullAt: 400, usedFraction: 0.875, alerted80At: at, alertedEmptyAt: null });
    const res = await adminSms(admin, { action: 'summary' });
    expect(res.body.balance).toMatchObject({ balance: 50, usedFraction: 0.875, alerted80At: at.toISOString(), alertedEmptyAt: null });
  });
});

describe('refresh', () => {
  it('one /balance call, recorded; a rise is a top-up and re-arms the alerts', async () => {
    await db.doc('config/smsBalance').set({ balance: 20, fullAt: 400, usedFraction: 0.95, alerted80At: new Date() });
    fakes.hashback.balance = 1000;
    const res = await adminSms(admin, { action: 'refresh' });
    expect(res.status).toBe(200);
    expect(balanceCalls()).toHaveLength(1);
    expect(res.body.balance).toMatchObject({ balance: 1000, fullAt: 1000, usedFraction: 0, alerted80At: null });
  });

  it('SMS not configured: says so, no call', async () => {
    const before = process.env.SMS_DISABLED;
    process.env.SMS_DISABLED = 'true';
    try {
      const res = await adminSms(admin, { action: 'refresh' });
      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).toMatch(/sms_unavailable/);
      expect(balanceCalls()).toHaveLength(0);
    } finally {
      if (before === undefined) delete process.env.SMS_DISABLED; else process.env.SMS_DISABLED = before;
    }
  });
});

describe('alert recipient', () => {
  it('set (audited), then back to the report recipient', async () => {
    let res = await adminSms(admin, { action: 'setAlertRecipient', email: 'Owner@School.example' });
    expect(res.body.alerts).toMatchObject({ recipient: 'owner@school.example', source: 'sms' });
    const audits = (await db.collection('audit').where('action', '==', 'sms.alert_recipient_changed').get()).docs;
    expect(audits).toHaveLength(1);
    res = await adminSms(admin, { action: 'resetAlertRecipient' });
    expect(res.body.alerts).toMatchObject({ recipient: 'reports@school.example', source: 'report' });
    expect((await db.doc('config/notifications').get()).data().smsAlertRecipient).toBeUndefined();
  });

  it('a bad or missing address is refused', async () => {
    expect((await adminSms(admin, { action: 'setAlertRecipient', email: 'not-an-email' })).status).toBe(400);
    expect((await adminSms(admin, { action: 'setAlertRecipient' })).status).toBe(400);
  });
});
