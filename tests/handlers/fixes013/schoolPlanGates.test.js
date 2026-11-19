import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, seedPlan,
} from '../_worker.js';

/**
 * 013Fixes / 00 — the plan comes from the SCHOOL (subscription/current), for
 * every login, never from the login's own `tier` claim.
 *
 * Before: requireTier read each login's claim, so a login created as Bronze on
 * a Gold school was refused Gold features, and a stale or crafted claim was
 * believed. These requests go through the real Worker against the emulators.
 */

const CRON = { authorization: 'Bearer ' };
let db;
let goldClaim; // a login whose claim says Gold
let bronzeClaim; // a login whose claim says Bronze
let noClaim; // a login with no plan claim at all (how new logins are made)
let admin;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  goldClaim = await userWithClaims('fx013-gold-claim', teacherClaims.gold);
  bronzeClaim = await userWithClaims('fx013-bronze-claim', teacherClaims.bronze);
  noClaim = await userWithClaims('fx013-no-claim', { role: 'teacher' });
  admin = await userWithClaims('fx013-admin', teacherClaims.superadmin);
  CRON.authorization = `Bearer ${process.env.CRON_SECRET}`;
});

beforeEach(async () => {
  await clearFirestore();
  await setFlags(db, { 'fees.enabled': true, 'calendar.enabled': true, 'sms.enabled': true });
});

const feesConfig = (token) => call('/api/fees/config', { method: 'GET', token });
const feedToken = (token) => call('/api/calendar/feedToken', { token, body: { action: 'list' } });

describe('a login\'s claim no longer decides the plan', () => {
  it('a Bronze school: a login with a crafted Gold claim is refused Silver features', async () => {
    await seedPlan(db, 'bronze');
    const res = await feesConfig(goldClaim);
    expect(res.status).toBe(403);
    expect(res.body.error?.code ?? res.body.code).toBe('tier_required');
  });

  it('a Gold school: a login with a stale Bronze claim is allowed', async () => {
    await seedPlan(db, 'gold');
    const res = await feesConfig(bronzeClaim);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('a Gold school: a new login with no plan claim gets the school\'s plan', async () => {
    await seedPlan(db, 'gold');
    expect((await feesConfig(noClaim)).status).toBe(200);
  });

  it('no subscription at all: gated features are refused even with a Gold claim', async () => {
    const res = await feesConfig(goldClaim);
    expect(res.status).toBe(403);
  });

  it('the superadmin passes on any plan', async () => {
    await seedPlan(db, 'bronze');
    expect((await feesConfig(admin)).status).toBe(200);
  });

  it('a lapsed school keeps its plan\'s features (status never changes features)', async () => {
    await seedPlan(db, 'silver', { status: 'locked' });
    expect((await feesConfig(bronzeClaim)).status).toBe(200);
  });

  it('Silver calendar is refused on Bronze and allowed on Silver, whatever the claim', async () => {
    await seedPlan(db, 'bronze');
    expect((await feedToken(goldClaim)).status).toBe(403);
    await seedPlan(db, 'silver');
    expect((await feedToken(bronzeClaim)).status).not.toBe(403);
  });

  it('a plan change made through superadmin applies straight away in this isolate', async () => {
    await seedPlan(db, 'bronze');
    expect((await feesConfig(noClaim)).status).toBe(403);
    // setTier needs a users/{uid} teacher record
    await db.doc('users/fx013-no-claim').set({ role: 'teacher', email: 'fx013-no-claim@harness.example' });
    const res = await call('/api/admin/users', { token: admin, body: { action: 'setTier', uid: 'fx013-no-claim', tier: 'silver' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await feesConfig(noClaim)).status).toBe(200);
  });
});

describe('the billing status call returns the school\'s plan', () => {
  it('with billing on: tier, features and limits from the school, not the claim', async () => {
    await setFlags(db, { 'billing.enabled': true });
    await seedPlan(db, 'gold', { grantedBySuperadmin: true });
    const res = await call('/api/billing/status', { method: 'GET', token: bronzeClaim });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.plan).toMatchObject({ tier: 'gold', comp: true, trialSmsUnits: 100 });
    expect(res.body.plan.features.targetedSms).toBe(true);
    expect(res.body.plan.limits).toEqual({ activeStudents: 500, sessions: 10, logins: 10, smsUnits: 3000 });
    expect(res.body.subscription).toMatchObject({ tier: 'gold', comp: true });
  });

  it('with billing off: the plan still comes back', async () => {
    await setFlags(db, { 'billing.enabled': false });
    await seedPlan(db, 'silver');
    const res = await call('/api/billing/status', { method: 'GET', token: noClaim });
    expect(res.status).toBe(200);
    expect(res.body.billingEnabled).toBe(false);
    expect(res.body.plan).toMatchObject({ tier: 'silver' });
    expect(res.body.plan.features.fees).toBe(true);
  });

  it('includes the superadmin\'s plan settings', async () => {
    await seedPlan(db, 'bronze');
    await db.doc('config/plans').set({ bronze: { features: { calendar: true }, limits: { logins: 3 } } });
    const res = await call('/api/billing/status', { method: 'GET', token: noClaim });
    expect(res.body.plan.features.calendar).toBe(true);
    expect(res.body.plan.limits.logins).toBe(3);
  });
});

describe('subscription/public carries comp and the period start', () => {
  it('the hourly sweep refreshes an old projection once, even for a comp school', async () => {
    await setFlags(db, { 'billing.enabled': true });
    const start = new Date('2026-11-01T00:00:00Z');
    await seedPlan(db, 'gold', { grantedBySuperadmin: true, currentPeriodStart: start });
    await db.doc('subscription/public').set({ tier: 'gold', status: 'active' }); // pre-013 shape

    const res = await call('/api/cron/subscriptionSweep', { headers: CRON, body: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const pub = (await db.doc('subscription/public').get()).data();
    expect(pub.comp).toBe(true);
    expect(pub.currentPeriodStart?.toMillis?.()).toBe(start.getTime());
    expect(pub).not.toHaveProperty('paystackAuthorizationCode');
  });

  it('superadmin setTier now writes the projection too', async () => {
    await db.doc('users/fx013-no-claim').set({ role: 'teacher', email: 'fx013-no-claim@harness.example' });
    const res = await call('/api/admin/users', { token: admin, body: { action: 'setTier', uid: 'fx013-no-claim', tier: 'gold' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await db.doc('subscription/public').get()).data()).toMatchObject({ tier: 'gold', comp: true });
  });
});
