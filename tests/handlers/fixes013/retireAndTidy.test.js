import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, getTestDb, clearFirestore, setFlags, seedPlan,
} from '../_worker.js';

/**
 * 013Fixes / 06 — WhatsApp campaigns retired (no plan has them; old ones stay
 * readable as history, nothing is deleted); choosing SMS recipients is Gold's
 * plan feature alone (the old whatsapp.advanced switch no longer gates it);
 * classes per session have a technical ceiling of 100, not a plan limit.
 */

let db;
let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx013r-teacher', { role: 'teacher' });
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'sms.enabled': true, 'sessions.teacherDefined': true });
});

const wa = (body) => call('/api/whatsapp/campaign', { token: teacher, body });

describe('WhatsApp campaigns are retired', () => {
  it('every action that creates or sends answers 410, on every plan', async () => {
    for (const tier of ['bronze', 'gold']) {
      await seedPlan(db, tier);
      for (const body of [
        { action: 'create', title: 'Notice', messageTemplate: 'Dear parent', filter: { type: 'all' } },
        { action: 'markRecipient', campaignId: 'c1', phone: '+254711000001', status: 'sent' },
        { action: 'complete', campaignId: 'c1' },
        { action: 'abandon', campaignId: 'c1' },
        { action: 'delete', campaignId: 'c1' },
        { action: 'options' },
      ]) {
        const res = await wa(body);
        expect(res.status, `${tier} ${body.action}`).toBe(410);
        expect(res.body.error.code).toBe('gone');
      }
    }
    expect((await db.collection('whatsapp/campaigns/items').get()).size).toBe(0);
  });

  it('attachments answer 410', async () => {
    await seedPlan(db, 'gold');
    const res = await call('/api/whatsapp/upload', { token: teacher, body: { filename: 'a.png', contentType: 'image/png', data: 'AAAA' } });
    expect(res.status).toBe(410);
  });

  it('old campaigns stay readable as history, on every plan, and are not deleted', async () => {
    await seedPlan(db, 'bronze');
    await db.doc('whatsapp/campaigns/items/old1').set({ title: 'Old notice', createdAt: new Date('2026-10-01T06:00:00Z'), status: 'completed' });
    await db.doc('whatsapp/campaigns/items/old1/recipients/r1').set({ order: 0, status: 'sent' });
    const list = await wa({ action: 'list' });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.campaigns.map((c) => c.id)).toEqual(['old1']);
    const one = await wa({ action: 'get', campaignId: 'old1' });
    expect(one.status).toBe(200);
    expect(one.body.recipients).toHaveLength(1);
    expect((await db.doc('whatsapp/campaigns/items/old1').get()).exists).toBe(true);
  });
});

describe('choosing SMS recipients is the plan\'s, not a switch', () => {
  const preview = (filter) => call('/api/messages/sms', { token: teacher, body: { action: 'preview', template: 'Hi', filter } });

  it('Gold may choose with the old whatsapp.advanced switch OFF (gets past the plan check)', async () => {
    await setFlags(db, { 'auth.legacyStudentRead': true, 'sms.enabled': true, 'whatsapp.advanced': false });
    await seedPlan(db, 'gold');
    const res = await preview({ type: 'class', values: ['Form 3'] });
    expect(res.body?.error?.code).not.toBe('tier_required');
  });

  it('Silver may not choose, with the switch ON', async () => {
    await setFlags(db, { 'auth.legacyStudentRead': true, 'sms.enabled': true, 'whatsapp.advanced': true });
    await seedPlan(db, 'silver');
    await db.doc('config/smsSetup').set({ unlockedAt: new Date(), schoolName: 'School' });
    const res = await preview({ type: 'class', values: ['Form 3'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('tier_required');
  });
});

describe('classes per session: a technical ceiling, not a plan limit', () => {
  const classes = (n) => Array.from({ length: n }, (_, i) => `Class ${i + 1}`);
  const save = (list) => call('/api/sessions/manage', {
    token: teacher, body: { action: 'create', name: 'Big school', slug: 'big', classes: list },
  });

  it('Bronze saves 31 classes (the old cap was 30) and up to 100', async () => {
    await seedPlan(db, 'bronze');
    const res = await save(classes(100));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(((await db.doc('sessions/big').get()).data().classes ?? []).length).toBe(100);
  });

  it('101 is refused, and the message never mentions a plan', async () => {
    await seedPlan(db, 'gold');
    const res = await save(classes(101));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/100 classes/);
    expect(JSON.stringify(res.body)).not.toMatch(/plan|upgrade|bronze|silver|gold/i);
  });
});
