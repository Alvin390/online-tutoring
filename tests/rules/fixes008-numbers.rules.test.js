import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, seed, validRegistration, PHONE_A, PHONE_B } from './helpers.js';

/**
 * 008Fixes / 01-03 — a confirmed phone, the admission / staff number and the
 * number reservations are the server's: a number is unique only because the
 * server creates its reservation in the same transaction that sets it. The
 * one-device lock (meta/checkinLock) is server-only, like meta/activity.
 */

let env;
const path = (phone) => `sessions/morning/students/${phone}`;
const base = (phone) => ({
  studentName: 'Kilemi', parentPhone: phone, session: 'morning', class: 'Form 3', blocked: false,
  approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
});
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, 'sessions/morning', { slug: 'morning', name: 'Morning', active: true });
  await seed(env, path(PHONE_A), { ...base(PHONE_A), admissionNumber: '4071', phoneVerifiedAt: new Date(), numberChosenAt: new Date() });
  await seed(env, path(PHONE_B), { ...base(PHONE_B), staff: true, staffNumber: '0042' });
  await seed(env, 'sessions/morning/numbers/A4071', { phone: PHONE_A, kind: 'student', number: '4071' });
  await seed(env, `${path(PHONE_A)}/meta/checkinLock`, { deviceHash: 'x', until: new Date(Date.now() + 3_600_000) });
});

describe('the fields are server-owned', () => {
  it('a teacher cannot set, change or clear a number or a confirmed phone', async () => {
    const t = teacher(env);
    await assertFails(updateDoc(doc(t, path(PHONE_A)), { admissionNumber: '5820' }));
    await assertFails(updateDoc(doc(t, path(PHONE_A)), { admissionNumber: null }));
    await assertFails(updateDoc(doc(t, path(PHONE_B)), { staffNumber: '0043' }));
    await assertFails(updateDoc(doc(t, path(PHONE_A)), { phoneVerifiedAt: null }));
    await assertFails(updateDoc(doc(t, path(PHONE_B)), { phoneVerifiedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(t, path(PHONE_A)), { numberChosenAt: serverTimestamp() }));
  });

  it('the dashboard\'s own edits still work on a numbered record', async () => {
    const t = teacher(env);
    await assertSucceeds(updateDoc(doc(t, path(PHONE_A)), { blocked: true, blockReason: 'Fees', blockedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(t, path(PHONE_A)), { approvalStatus: 'approved' }, { merge: true }));
  });

  it('a client registration carrying a number or a confirmed phone is refused; without, accepted', async () => {
    const fresh = '+254711000778';
    await assertFails(setDoc(doc(anon(env), path(fresh)), { ...validRegistration(fresh), admissionNumber: '4071' }));
    await assertFails(setDoc(doc(anon(env), path(fresh)), { ...validRegistration(fresh), phoneVerifiedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(anon(env), path(fresh)), validRegistration(fresh)));
  });
});

describe('reservations and the lock are closed to every browser', () => {
  it('nobody reads or writes a reservation', async () => {
    for (const db of [anon(env), teacher(env)]) {
      await assertFails(getDoc(doc(db, 'sessions/morning/numbers/A4071')));
      await assertFails(setDoc(doc(db, 'sessions/morning/numbers/A5820'), { phone: PHONE_B, kind: 'student', number: '5820' }));
      await assertFails(deleteDoc(doc(db, 'sessions/morning/numbers/A4071')));
    }
  });

  it('the lock: the teacher may read it, nobody writes it', async () => {
    await assertSucceeds(getDoc(doc(teacher(env), `${path(PHONE_A)}/meta/checkinLock`)));
    await assertFails(getDoc(doc(anon(env), `${path(PHONE_A)}/meta/checkinLock`)));
    await assertFails(deleteDoc(doc(teacher(env), `${path(PHONE_A)}/meta/checkinLock`)));
    await assertFails(setDoc(doc(anon(env), `${path(PHONE_A)}/meta/checkinLock`), { deviceHash: 'y' }));
  });
});
