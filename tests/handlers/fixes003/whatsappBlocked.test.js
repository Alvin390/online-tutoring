import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 003Fixes / 09 — "Message these parents on WhatsApp" after a bulk block: the
 * bulk action lists who it reached, and a campaign can target exactly those
 * (session, number) pairs, up to 500.
 */

let db;
let gold;
let other;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims('fx003-wa-gold', teacherClaims.gold);
  other = await userWithClaims('fx003-wa-other', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'whatsapp.broadcast': true, 'whatsapp.advanced': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true });
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: 'Student', parentPhone: phone, class: 'Form 3', subjects: 'English', session,
  registeredAt: new Date('2026-10-01T06:00:00Z'), blocked: false, approvalStatus: 'approved', ...extra,
});
const campaign = (values) => call('/api/whatsapp/campaign', {
  token: gold,
  body: { action: 'create', title: 'Blocked', messageTemplate: 'Dear parent, {{studentName}}', filter: { type: 'individual', values } },
});

describe('who a bulk action reached', () => {
  it('lists the students it changed, for its own teacher only', async () => {
    await seed('morning', phoneN(1));
    await seed('morning', phoneN(2), { approvalStatus: 'pending' });
    const res = await call('/api/students/bulk', { token: gold, body: { action: 'block', kind: 'other', items: [{ session: 'morning', phone: phoneN(1) }, { session: 'morning', phone: phoneN(2) }] } });
    const items = await call('/api/students/bulk', { token: gold, body: { action: 'items', batchId: res.body.batchId } });
    expect(items.body.items).toEqual([{ session: 'morning', phone: phoneN(1) }]);
    expect((await call('/api/students/bulk', { token: other, body: { action: 'items', batchId: res.body.batchId } })).status).toBe(403);
  });
});

describe('campaign "Chosen students" by session and number', () => {
  it('a session-qualified value reaches only that session\'s student; plain numbers still work', async () => {
    await seed('morning', phoneN(10), { blocked: true });
    await seed('evening', phoneN(10));
    await seed('morning', phoneN(11));
    const qualified = await campaign([`morning:${phoneN(10)}`]);
    expect(qualified.status, JSON.stringify(qualified.body)).toBe(200);
    expect(qualified.body.recipientCount).toBe(1);
    const recipients = await db.collection(`whatsapp/campaigns/items/${qualified.body.campaignId}/recipients`).get();
    expect(recipients.docs[0].data().session).toBe('morning');

    const plain = await campaign([phoneN(11)]);
    expect(plain.body.recipientCount).toBe(1);
  });

  it('accepts 500 values and refuses 501', async () => {
    await seed('morning', phoneN(20));
    const many = Array.from({ length: 499 }, (_, i) => `morning:${phoneN(1000 + i)}`);
    expect((await campaign([`morning:${phoneN(20)}`, ...many])).status).toBe(200);
    expect((await campaign([...many, `morning:${phoneN(20)}`, `morning:${phoneN(21)}`])).status).toBe(400);
  });
});
