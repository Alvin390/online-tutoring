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
// 013Fixes / 06: WhatsApp campaigns are retired; the same "chosen students"
// rule lives on in resolveRecipients, which SMS uses. Tested there directly.
const chosen = async (values) => {
  const { resolveRecipients } = await import('../../../api/_lib/messageRecipients.js');
  return resolveRecipients(db, { type: 'individual', values });
};

describe('who a bulk action reached', () => {
  // 004Fixes / 02: any staff account may read it (it was its own teacher only).
  it('lists the students it changed, for any staff account', async () => {
    await seed('morning', phoneN(1));
    await seed('morning', phoneN(2), { approvalStatus: 'pending' });
    const res = await call('/api/students/bulk', { token: gold, body: { action: 'block', kind: 'other', items: [{ session: 'morning', phone: phoneN(1) }, { session: 'morning', phone: phoneN(2) }] } });
    const items = await call('/api/students/bulk', { token: gold, body: { action: 'items', batchId: res.body.batchId } });
    expect(items.body.items).toEqual([{ session: 'morning', phone: phoneN(1) }]);
    expect((await call('/api/students/bulk', { token: other, body: { action: 'items', batchId: res.body.batchId } })).body.items)
      .toEqual([{ session: 'morning', phone: phoneN(1) }]);
  });
});

describe('"Chosen students" by session and number (resolveRecipients, used by SMS)', () => {
  it('a session-qualified value reaches only that session\'s student; plain numbers still work', async () => {
    await seed('morning', phoneN(10), { blocked: true });
    await seed('evening', phoneN(10));
    await seed('morning', phoneN(11));
    const qualified = await chosen([`morning:${phoneN(10)}`]);
    expect(qualified).toHaveLength(1);
    expect(qualified[0].session).toBe('morning');

    expect(await chosen([phoneN(11)])).toHaveLength(1);
  });

  it('SMS takes up to 1,000 chosen values and refuses 1,001 (validation, before anything else)', async () => {
    const values = (n) => Array.from({ length: n }, (_, i) => `morning:${phoneN(1000 + i)}`);
    const preview = (n) => call('/api/messages/sms', { token: gold, body: { action: 'preview', template: 'Hi', filter: { type: 'individual', values: values(n) } } });
    await setFlags(db, { 'auth.legacyStudentRead': true, 'sms.enabled': true });
    expect((await preview(1001)).status).toBe(400);
    expect((await preview(1000)).status).not.toBe(400);
  });
});
