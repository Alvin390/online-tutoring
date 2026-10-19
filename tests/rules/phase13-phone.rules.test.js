import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { makeTestEnv, anon } from './helpers.js';

/**
 * Phase 13 / 03 D4 — the rules refuse a national trunk "0" after the country
 * code (validated before: +254071234567 was accepted on registration).
 */

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const registration = (phone) => ({
  studentName: 'Amina Wanjiru', parentPhone: phone, class: 'Grade 8', subjects: 'Mathematics',
  receiptMessage: 'QAB123XYZ9 Confirmed', registeredAt: serverTimestamp(), session: 'morning',
  blocked: false, approvalStatus: 'pending', receiptStatus: 'pending', feeBalance: 0,
});

describe('phone ids', () => {
  it('denies +254071234567', async () => {
    await assertFails(setDoc(doc(anon(env), 'sessions/morning/students/+254071234567'), registration('+254071234567')));
  });

  it('denies a UK number with a trunk 0', async () => {
    await assertFails(setDoc(doc(anon(env), 'sessions/morning/students/+4407700900123'), registration('+4407700900123')));
  });

  it('allows +254712345678', async () => {
    await assertSucceeds(setDoc(doc(anon(env), 'sessions/morning/students/+254712345678'), registration('+254712345678')));
  });

  it('allows an Italian number with its 0 (not a trunk-0 country)', async () => {
    await assertSucceeds(setDoc(doc(anon(env), 'sessions/morning/students/+390612345678'), registration('+390612345678')));
  });
});
