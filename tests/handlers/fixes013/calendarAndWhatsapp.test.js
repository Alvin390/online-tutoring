import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, getTestDb, clearFirestore, setFlags, seedPlan,
} from '../_worker.js';

/**
 * 013Fixes / 02 — the calendar and one-to-one WhatsApp are on every plan
 * (owner). The calendar's global switch still turns it off for everyone.
 * The Messages endpoint opens to Bronze for what one-to-one WhatsApp needs
 * (who can be messaged, the sent history); setting up and sending SMS stays
 * the plan's `bulkSms`.
 */

let db;
let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx013c-teacher', { role: 'teacher' });
});

beforeEach(async () => {
  await clearFirestore();
  await setFlags(db, { 'calendar.enabled': true, 'sms.enabled': true });
});

const manage = (body) => call('/api/calendar/manage', { token: teacher, body });
const feed = (body) => call('/api/calendar/feedToken', { token: teacher, body });
const sms = (body) => call('/api/messages/sms', { token: teacher, body });

const EVENT = {
  action: 'create', title: 'Maths', start: '2026-12-07T05:00:00.000Z', end: '2026-12-07T06:00:00.000Z',
  recurrence: { freq: 'weekly', interval: 1, byDay: [1], until: null },
};

describe('calendar on every plan', () => {
  for (const tier of ['bronze', 'silver', 'gold']) {
    it(`${tier}: manage the calendar and get a feed token`, async () => {
      await seedPlan(db, tier);
      const created = await manage(EVENT);
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const issued = await feed({ action: 'issue', role: 'teacher' });
      expect(issued.status, JSON.stringify(issued.body)).toBe(200);
      expect((await feed({ action: 'list' })).status).toBe(200);
    });
  }

  it('the global switch off refuses every plan, Gold included', async () => {
    await setFlags(db, { 'calendar.enabled': false });
    for (const tier of ['bronze', 'gold']) {
      await seedPlan(db, tier);
      const res = await manage(EVENT);
      expect(res.status, tier).toBe(403);
      expect(res.body.error.code).not.toBe('tier_required');
    }
  });

  it('no subscription is still no plan', async () => {
    expect((await manage(EVENT)).status).toBe(403);
  });
});

describe('Messages on Bronze: one-to-one WhatsApp reads; SMS stays Silver', () => {
  it('Bronze can list who can be messaged and the sent history', async () => {
    await seedPlan(db, 'bronze');
    await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true });
    for (const action of ['people', 'list']) {
      const res = await sms({ action });
      expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
    }
    expect((await sms({ action: 'get', campaignId: 'nope' })).status).toBe(404);
  });

  it('Bronze cannot set up or send SMS, even through a crafted request', async () => {
    await seedPlan(db, 'bronze');
    for (const body of [
      { action: 'setup' },
      { action: 'saveSchoolName', schoolName: 'Test School' },
      { action: 'preview', template: 'Hi', filter: { type: 'all' } },
      { action: 'start', template: 'Hi', filter: { type: 'all' } },
      { action: 'sendOne', session: 'evening', phone: '+254711000001', template: 'Hi' },
      { action: 'cancel', campaignId: 'nope' },
      { action: 'refresh', campaignId: 'nope' },
    ]) {
      const res = await sms(body);
      expect(res.status, body.action).toBe(403);
      expect(res.body.error.code, body.action).toBe('tier_required');
    }
  });

  it('Silver still sets up SMS', async () => {
    await seedPlan(db, 'silver');
    expect((await sms({ action: 'setup' })).status).toBe(200);
  });

  it('with SMS switched off, Bronze still reads the people list', async () => {
    await setFlags(db, { 'sms.enabled': false });
    await seedPlan(db, 'bronze');
    expect((await sms({ action: 'people' })).status).toBe(200);
    expect((await sms({ action: 'start', template: 'Hi', filter: { type: 'all' } })).body.error.code).toBe('sms_off');
  });
});
