import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pinEnv, installFetchGuard, call, userWithClaims, getTestDb, clearFirestore, setFlags, seedPlan, resetFakes, fakes,
} from '../_worker.js';

/**
 * 013Fixes / 15 — sends are charged against the school's SMS units: a preview
 * uses none; a start needs enough for the whole message; each chunk takes its
 * units inside the claim (exactly once) and gives back the units of anyone not
 * sent. Included units go first, then top-up. Bronze is refused even with a
 * top-up; check-in codes never touch the units.
 */

let db;
let teacher;
const P = (n) => `+2547170${String(10000 + n).padStart(5, '0')}`;
const start = new Date('2026-10-14T13:00:00Z');

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx013m-teacher', { role: 'teacher' });
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'sms.enabled': true, 'fees.enabled': true });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true, classes: ['Form 3'] });
  await db.doc('config/smsSetup').set({ schoolName: 'Focus', unlockedAt: new Date() });
  await db.doc('config/notifications').set({ reportRecipient: 'reports@school.example' });
});

const seed = (phone) => db.doc(`sessions/evening/students/${phone}`).set({
  studentName: 'Kid', parentPhone: phone, class: 'Form 3', subjects: 'English', session: 'evening',
  registeredAt: new Date('2026-10-01T06:00:00Z'), blocked: false, approvalStatus: 'approved', feeBalance: 0,
});
const sms = (body) => call('/api/messages/sms', { token: teacher, body });
const state = async () => (await db.doc('sms/credits').get()).data();
const ledgerOf = async (type) => (await db.collection('sms/credits/ledger').get()).docs.map((d) => d.data()).filter((e) => e.type === type);

/** Silver with `units` included and `topup` extra (the plan setting sets the included amount). */
async function silverWith(units, topup = 0) {
  await seedPlan(db, 'silver', { currentPeriodStart: start });
  await db.doc('config/plans').set({ silver: { limits: { smsUnits: units } } });
  (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
  if (topup) {
    const admin = await userWithClaims('fx013m-admin', { role: 'superadmin' });
    await call('/api/admin/sms', { token: admin, body: { action: 'addUnits', units: topup, key: `seed-topup-${Date.now()}` } });
  }
}

async function sendAll(campaignId) {
  for (let i = 0; i < 10; i += 1) {
    const r = await sms({ action: 'sendChunk', campaignId }); // eslint-disable-line no-await-in-loop
    if (r.status !== 200 || r.body.done || r.body.retryAfter) return r;
  }
  return null;
}

describe('charging', () => {
  it('a preview uses nothing and says what is left', async () => {
    await silverWith(10);
    for (const n of [1, 2, 3]) await seed(P(n));
    const res = await sms({ action: 'preview', template: 'Hi', filter: { type: 'all' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ units: 3, unitsLeft: 10, enoughUnits: true });
    expect((await state()).includedUsed).toBe(0);
  });

  it('a campaign uses exactly the units sent, included first then top-up', async () => {
    await silverWith(2, 5);
    for (const n of [1, 2, 3]) await seed(P(n));
    const started = await sms({ action: 'start', template: 'Hi', filter: { type: 'all' } });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect((await state()).includedUsed).toBe(0); // nothing is taken before sending
    await sendAll(started.body.campaignId);
    expect(fakes.hashback.sent).toHaveLength(3);
    expect(await state()).toMatchObject({ includedUsed: 2, topup: 4 });
    expect(await ledgerOf('reserve')).toEqual([expect.objectContaining({ units: -3, fromIncluded: 2, fromTopup: 1 })]);
    // A repeat call has nothing left to claim and charges nothing more.
    await sms({ action: 'sendChunk', campaignId: started.body.campaignId });
    expect(await state()).toMatchObject({ includedUsed: 2, topup: 4 });
  });

  it('a two-unit message counts as two', async () => {
    await silverWith(10);
    await seed(P(1));
    const long = 'x'.repeat(200);
    const started = await sms({ action: 'start', template: long, filter: { type: 'all' } });
    expect(started.body.units).toBe(2);
    await sendAll(started.body.campaignId);
    expect((await state()).includedUsed).toBe(2);
  });

  it('a number the provider refuses is given back', async () => {
    await silverWith(10);
    for (const n of [1, 2]) await seed(P(n));
    fakes.hashback.failFor.set(P(2), { code: 'INVALID_NUMBER', status: 400 });
    const started = await sms({ action: 'start', template: 'Hi', filter: { type: 'all' } });
    await sendAll(started.body.campaignId);
    expect((await state()).includedUsed).toBe(1);
    expect(await ledgerOf('refund')).toEqual([expect.objectContaining({ units: 1 })]);
  });

  it('a busy provider puts them back in the queue and gives the units back until they go', async () => {
    await silverWith(10);
    await seed(P(1));
    fakes.hashback.fail = { code: 'RATE_LIMITED', status: 429, retryAfter: 5 };
    const started = await sms({ action: 'start', template: 'Hi', filter: { type: 'all' } });
    const first = await sms({ action: 'sendChunk', campaignId: started.body.campaignId });
    expect(first.body.retryAfter).toBeTruthy();
    expect((await state()).includedUsed).toBe(0);
    fakes.hashback.fail = null;
    await sendAll(started.body.campaignId);
    expect((await state()).includedUsed).toBe(1);
  });

  it('a cancelled campaign charges nothing for those never sent', async () => {
    await silverWith(10);
    for (const n of [1, 2, 3]) await seed(P(n));
    const started = await sms({ action: 'start', template: 'Hi', filter: { type: 'all' } });
    expect((await sms({ action: 'cancel', campaignId: started.body.campaignId })).status).toBe(200);
    expect((await state()).includedUsed).toBe(0);
    expect(fakes.hashback.sent).toHaveLength(0);
  });
});

describe('when the units run out', () => {
  it('a start that needs more than is left is refused, and nothing is queued', async () => {
    await silverWith(2);
    for (const n of [1, 2, 3]) await seed(P(n));
    const res = await sms({ action: 'start', template: 'Hi', filter: { type: 'all' } });
    expect(res.status).toBe(402);
    expect(res.body.error).toMatchObject({ code: 'sms_credit_exhausted', message: "You've used your SMS units. Contact us for more." });
    expect((await db.collection('sms/campaigns/items').get()).size).toBe(0);
    expect(fakes.hashback.sent).toHaveLength(0);
  });

  it('a chunk that finds the units gone stops, and the campaign waits', async () => {
    await silverWith(3);
    for (const n of [1, 2, 3]) await seed(P(n));
    const started = await sms({ action: 'start', template: 'Hi', filter: { type: 'all' } });
    await db.doc('sms/credits').set({ includedUsed: 3 }, { merge: true }); // used elsewhere meanwhile
    const res = await sms({ action: 'sendChunk', campaignId: started.body.campaignId });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('sms_credit_exhausted');
    expect(fakes.hashback.sent).toHaveLength(0);
    expect((await db.doc(`sms/campaigns/items/${started.body.campaignId}`).get()).data().status).toBe('paused_no_units');
  });

  it('one message to one person is charged and refused alike', async () => {
    await silverWith(1);
    await seed(P(1));
    const one = await sms({ action: 'sendOne', session: 'evening', phone: P(1), template: 'Hi' });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect((await state()).includedUsed).toBe(1);
    expect((await sms({ action: 'sendOne', session: 'evening', phone: P(1), template: 'Hi' })).body.error.code).toBe('sms_credit_exhausted');
  });
});

describe('who may send', () => {
  it('Bronze is refused even with top-up units', async () => {
    await seedPlan(db, 'bronze', { currentPeriodStart: start });
    await db.doc('sms/credits').set({ windowId: `period-${start.getTime()}`, granted: 0, includedUsed: 0, topup: 500 });
    await seed(P(1));
    const res = await sms({ action: 'start', template: 'Hi', filter: { type: 'all' } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tier_required');
  });

  it('Silver may not choose recipients; Gold may', async () => {
    await silverWith(10);
    await seed(P(1));
    expect((await sms({ action: 'preview', template: 'Hi', filter: { type: 'class', values: ['Form 3'] } })).body.error.code).toBe('tier_required');
    await seedPlan(db, 'gold', { currentPeriodStart: start });
    expect((await sms({ action: 'preview', template: 'Hi', filter: { type: 'class', values: ['Form 3'] } })).status).toBe(200);
  });
});

describe('what is never charged', () => {
  it('every place that sends an SMS is known: campaigns are charged; check-in codes and the setup test are not', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'api');
    const callers = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!name.endsWith('.js') || name === 'sms.js' && dir.endsWith('_lib')) continue;
        if (/\bsendSms\(/.test(readFileSync(full, 'utf8'))) callers.push(full.replace(/\\/g, '/').split('/api/')[1]);
      }
    };
    walk(root);
    // _lib/smsCampaign.js — charged (sendChunk); _lib/otpIssue.js — check-in codes, the owner's wallet;
    // messages/sms.js — only the one setup test text to the teacher's own phone.
    expect(callers.sort()).toEqual(['_lib/otpIssue.js', '_lib/smsCampaign.js', 'messages/sms.js']);
    const smsRoute = readFileSync(join(root, 'messages/sms.js'), 'utf8');
    expect(smsRoute.match(/\bsendSms\(/g)).toHaveLength(1);
    expect(smsRoute.slice(smsRoute.indexOf("body.action === 'sendTest'"), smsRoute.indexOf("body.action === 'unlock'"))).toMatch(/sendSms\(/);
  });
});

// 013Fixes / 16: the screens read the units without changing anything.
describe('showing the units', () => {
  it('the composer setup carries the units, and reading them writes nothing', async () => {
    await silverWith(1000, 0);
    const res = await sms({ action: 'setup' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.units).toMatchObject({ granted: 1000, includedLeft: 1000, topup: 0, available: 1000, kind: 'period' });
    expect((await db.doc('sms/credits').get()).exists).toBe(false);
  });

  it('the billing status shows the SMS row on a plan with SMS, not on Bronze', async () => {
    await silverWith(1000, 0);
    expect((await call('/api/billing/status', { method: 'GET', token: teacher })).body.plan.smsUnits).toMatchObject({ granted: 1000 });
    await seedPlan(db, 'bronze', { currentPeriodStart: start });
    expect((await call('/api/billing/status', { method: 'GET', token: teacher })).body.plan.smsUnits).toBeNull();
  });
});

