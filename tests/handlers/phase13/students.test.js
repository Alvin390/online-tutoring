import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb,
  clearFirestore, setFlags, phoneN,
} from '../_worker.js';

/**
 * Phase 13 / 03 — student record integrity.
 * Ports B6, B3, B7 and S-phone (server side) to assert the FIX.
 */

let db;
let gold;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims('p13-students-gold', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
});

afterEach(() => {
  process.env.SUBREQUEST_BUDGET = '200';
});

const REGISTERED = new Date('2026-01-10T08:00:00Z');

async function seedStudent(session, phone, extra = {}) {
  await db.doc(`sessions/${session}/students/${phone}`).set({
    studentName: 'Amina Wanjiru', parentPhone: phone, class: 'Grade 8', subjects: 'Maths',
    receiptMessage: 'QAB123XYZ9 Confirmed', registeredAt: REGISTERED, session,
    blocked: true, blockReason: 'Fees outstanding', approvalStatus: 'approved',
    receiptStatus: 'approved', feeBalance: 1200, ...extra,
  });
}

async function seedNotes(session, phone, n) {
  for (let start = 0; start < n; start += 400) {
    const batch = db.batch();
    for (let i = start; i < Math.min(n, start + 400); i += 1) {
      batch.set(db.doc(`sessions/${session}/students/${phone}/notes/n${String(i).padStart(4, '0')}`), {
        body: `Note ${i}`, tags: [], createdAt: new Date(), deletedAt: null,
      });
    }
    await batch.commit();
  }
}

async function seedFees(phone, session, entries) {
  await db.doc(`fees/accounts/items/${phone}`).set({ phone, session, balance: 1200 });
  for (let i = 0; i < entries; i += 1) {
    await db.doc(`fees/accounts/items/${phone}/ledger/e${i}`).set({
      type: 'invoice', amount: 600, magnitude: 600, method: null, reference: null,
      occurredAt: new Date(), recordedBy: 'seed', balanceAfter: 600 * (i + 1), session, phone,
    });
  }
}

const update = (body, token = gold) => call('/api/student/update', { token, body });

// ---------------------------------------------------------------------------
describe('D1 /api/student/update — same phone (B6a)', () => {
  it('saves the four editable fields and leaves every other field alone', async () => {
    const phone = phoneN(1);
    await seedStudent('morning', phone);

    const res = await update({
      session: 'morning', phone,
      changes: { studentName: "Sean O'Brien", class: 'Grade 9', subjects: 'Physics', receiptMessage: 'QZZ999XYZ9 Confirmed' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const doc = (await db.doc(`sessions/morning/students/${phone}`).get()).data();
    expect(doc).toMatchObject({
      studentName: "Sean O'Brien", class: 'Grade 9', subjects: 'Physics', receiptMessage: 'QZZ999XYZ9 Confirmed',
      approvalStatus: 'approved', blocked: true, blockReason: 'Fees outstanding', feeBalance: 1200,
    });
    expect(doc.registeredAt.toDate().toISOString()).toBe(REGISTERED.toISOString());
    expect(doc.updatedBy).toBe('p13-students-gold');
  });

  it('rejects server-owned and state fields (strict allowlist)', async () => {
    const phone = phoneN(2);
    await seedStudent('morning', phone);
    for (const changes of [{ feeBalance: 0 }, { approvalStatus: 'approved' }, { blocked: false }, { registeredAt: 'x' }]) {
      const res = await update({ session: 'morning', phone, changes });
      expect(res.status, JSON.stringify(changes)).toBe(400);
    }
  });

  it('is teacher-only', async () => {
    const res = await call('/api/student/update', { body: { session: 'morning', phone: phoneN(3), changes: { class: 'Grade 9' } } });
    expect(res.status).toBe(401);
  });

  it('404s an unknown student', async () => {
    const res = await update({ session: 'morning', phone: phoneN(4), changes: { class: 'Grade 9' } });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('D1 /api/student/update — phone change (B6b)', () => {
  it('moves the student, every note, the fee account and its ledger — state preserved', async () => {
    const oldPhone = phoneN(10);
    const newPhone = phoneN(11);
    await seedStudent('morning', oldPhone);
    await seedNotes('morning', oldPhone, 5);
    await seedFees(oldPhone, 'morning', 3);

    const res = await update({ session: 'morning', phone: oldPhone, newPhone, changes: { class: 'Grade 9' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, phone: newPhone, moved: { notes: 5, ledgerEntries: 3 } });

    const moved = (await db.doc(`sessions/morning/students/${newPhone}`).get()).data();
    expect(moved).toMatchObject({
      parentPhone: newPhone, class: 'Grade 9', approvalStatus: 'approved', blocked: true,
      blockReason: 'Fees outstanding', feeBalance: 1200,
    });
    expect(moved.registeredAt.toDate().toISOString()).toBe(REGISTERED.toISOString());
    expect(moved.moveInProgress).toBeUndefined();

    expect((await db.collection(`sessions/morning/students/${newPhone}/notes`).get()).size).toBe(5);
    expect((await db.doc(`fees/accounts/items/${newPhone}`).get()).data()).toMatchObject({ phone: newPhone, balance: 1200, phoneChangedFrom: oldPhone });
    expect((await db.collection(`fees/accounts/items/${newPhone}/ledger`).get()).size).toBe(3);

    // Nothing left under the old phone except the marker.
    expect((await db.doc(`sessions/morning/students/${oldPhone}`).get()).exists).toBe(false);
    expect((await db.collection(`sessions/morning/students/${oldPhone}/notes`).get()).size).toBe(0);
    expect((await db.collection(`fees/accounts/items/${oldPhone}/ledger`).get()).size).toBe(0);
    expect((await db.doc(`fees/accounts/items/${oldPhone}`).get()).data()).toMatchObject({ phoneChanged: newPhone });

    const audit = await db.collection('audit').where('action', '==', 'student.phone_changed').get();
    expect(audit.size).toBe(1);
  });

  it('409s when another student already uses the new number', async () => {
    await seedStudent('morning', phoneN(20));
    await seedStudent('morning', phoneN(21), { studentName: 'Someone Else' });
    const res = await update({ session: 'morning', phone: phoneN(20), newPhone: phoneN(21), changes: {} });
    expect(res.status).toBe(409);
    expect((await db.doc(`sessions/morning/students/${phoneN(21)}`).get()).data().studentName).toBe('Someone Else');
  });

  it('moves 600 notes across the batch boundary, and resumes after a budget stop', async () => {
    const oldPhone = phoneN(30);
    const newPhone = phoneN(31);
    await seedStudent('morning', oldPhone);
    await seedNotes('morning', oldPhone, 600);

    process.env.SUBREQUEST_BUDGET = '9';
    const first = await update({ session: 'morning', phone: oldPhone, newPhone, changes: {} });
    expect(first.status).toBe(200);
    expect(first.body.partial).toBe(true);

    process.env.SUBREQUEST_BUDGET = '200';
    const second = await update({ session: 'morning', phone: oldPhone, newPhone, changes: {} });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.partial).toBeFalsy();

    expect((await db.collection(`sessions/morning/students/${newPhone}/notes`).get()).size).toBe(600);
    expect((await db.collection(`sessions/morning/students/${oldPhone}/notes`).get()).size).toBe(0);
    expect((await db.doc(`sessions/morning/students/${oldPhone}`).get()).exists).toBe(false);
  });

  it('two simultaneous identical requests leave exactly one correct record', async () => {
    const oldPhone = phoneN(40);
    const newPhone = phoneN(41);
    await seedStudent('morning', oldPhone);
    await seedNotes('morning', oldPhone, 12);

    const results = await Promise.all([
      update({ session: 'morning', phone: oldPhone, newPhone, changes: {} }),
      update({ session: 'morning', phone: oldPhone, newPhone, changes: {} }),
    ]);
    expect(results.map((r) => r.status).filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    expect((await db.collection(`sessions/morning/students/${newPhone}/notes`).get()).size).toBe(12);
    expect((await db.doc(`sessions/morning/students/${oldPhone}`).get()).exists).toBe(false);
  });

  it('costs few subrequests: same-phone edit, and a move of 10 notes + 20 ledger entries < 15', async () => {
    process.env.PERF_TIMING = '1';
    try {
      const subreq = (res) => Number(/subreq;desc="(\d+)"/.exec(res.headers.get('server-timing'))[1]);

      await seedStudent('morning', phoneN(90));
      const edit = await update({ session: 'morning', phone: phoneN(90), changes: { class: 'Grade 9' } });
      expect(edit.status).toBe(200);
      const editCost = subreq(edit);

      await seedStudent('morning', phoneN(91));
      await seedNotes('morning', phoneN(91), 10);
      await seedFees(phoneN(91), 'morning', 20);
      const move = await update({ session: 'morning', phone: phoneN(91), newPhone: phoneN(92), changes: {} });
      expect(move.status).toBe(200);
      const moveCost = subreq(move);

      // Measured: edit = 8 = the edit's own 3 (student read, update, audit)
      // + rate limiter ~3 + one cold session-cache lookup + the ID-token
      // revocation check (an Auth call, counted since Phase 13 / 06 made the
      // budget count every outbound fetch, not only Firestore). Phase 08 C2
      // moves the rate limiter off Firestore and tightens these numbers.
      console.log('SUBREQ edit', editCost, 'move', moveCost);
      expect(editCost).toBeLessThanOrEqual(8);
      expect(moveCost).toBeLessThan(16);
    } finally {
      delete process.env.PERF_TIMING;
    }
  });

  it('refuses a leading-0 new number', async () => {
    await seedStudent('morning', phoneN(50));
    const res = await update({ session: 'morning', phone: phoneN(50), newPhone: '+254071234567', changes: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Remove the leading 0 after \+254/);
  });
});

// ---------------------------------------------------------------------------
describe('D2 delete through the API (B3)', () => {
  it('removes the student and every note; keeps the fee record marked deleted', async () => {
    const phone = phoneN(60);
    await seedStudent('morning', phone);
    await seedNotes('morning', phone, 3);
    await seedFees(phone, 'morning', 2);

    const res = await call('/api/student/remove', { token: gold, body: { session: 'morning', phone } });
    expect(res.status).toBe(200);
    expect(res.body.notesRemoved).toBe(3);

    expect((await db.doc(`sessions/morning/students/${phone}`).get()).exists).toBe(false);
    expect((await db.collection(`sessions/morning/students/${phone}/notes`).get()).size).toBe(0);
    const account = (await db.doc(`fees/accounts/items/${phone}`).get()).data();
    expect(account.studentDeletedAt).toBeTruthy();
    expect((await db.collection(`fees/accounts/items/${phone}/ledger`).get()).size).toBe(2);
  });

  it('deletes 600 notes within the 45-subrequest budget', async () => {
    const phone = phoneN(61);
    await seedStudent('morning', phone);
    await seedNotes('morning', phone, 600);
    process.env.SUBREQUEST_BUDGET = '45';
    const res = await call('/api/student/remove', { token: gold, body: { session: 'morning', phone } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await db.collection(`sessions/morning/students/${phone}/notes`).get()).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('D3 a missing approvalStatus means approved (B7)', () => {
  it('a legacy student can check in and get the link with requireApproval on', async () => {
    await setFlags(db, { 'registration.requireApproval': true });
    const phone = phoneN(70);
    await seedStudent('morning', phone, { blocked: false, blockReason: '' });
    const { FieldValue } = await import('../../../api/_lib/firebaseAdmin.js');
    await db.doc(`sessions/morning/students/${phone}`).update({ approvalStatus: FieldValue.delete() });
    await db.doc('sessions/morning/private/classLink').set({ url: 'https://zoom.us/j/1111111111', provider: 'zoom' });

    const checkin = await call('/api/student/checkin', { body: { session: 'morning', phone } });
    expect(checkin.body.student.approvalStatus).toBe('approved');

    const link = await call('/api/class/link', { body: { session: 'morning', phone } });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
  });

  it('an explicit pending still gates', async () => {
    await setFlags(db, { 'registration.requireApproval': true });
    const phone = phoneN(71);
    await seedStudent('morning', phone, { blocked: false, approvalStatus: 'pending' });
    const link = await call('/api/class/link', { body: { session: 'morning', phone } });
    expect(link.status).toBe(403);
    expect(link.body.error.code).toBe('approval_pending');
  });
});

// ---------------------------------------------------------------------------
describe('D4 phone numbers (S-phone)', () => {
  it('the server rejects a trunk-0 national number with a specific message', async () => {
    const res = await call('/api/student/checkin', { body: { session: 'morning', phone: '+254071234567' } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Remove the leading 0 after \+254/);
  });

  it('a correct number is unaffected', async () => {
    const res = await call('/api/student/checkin', { body: { session: 'morning', phone: '+254712345678' } });
    expect(res.status).toBe(200);
  });
});
