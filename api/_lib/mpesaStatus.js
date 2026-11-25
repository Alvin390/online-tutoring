import { getDb, FieldValue } from './firebaseAdmin.js';
import { interpretResultCode } from './daraja.js';

/**
 * M-Pesa (STK) — 013Fixes / 30b (owner, 2026-11-25). One setting, three
 * positions, in config/mpesaStatus:
 *
 *   mode   'off'  hidden everywhere
 *          'demo' Pay now for every blocked student, through the SANDBOX; a
 *                 demo payment never touches fees or blocks (mpesa/demo)
 *          'live' the school's live keys: UNTESTED (hidden) until the KES 1
 *                 test is confirmed, then TESTED (shown)
 *   testedFingerprint   the live keys' fingerprint when the test was confirmed
 *                       (credentialsFingerprint: a hash, never the values);
 *                       "tested" holds only while the keys in use match it
 *   the test in flight: testCheckoutId, testFingerprint, testStartedAt,
 *     testPhoneMasked, testLastQueriedAt; then testedAt / lastError
 *
 * The test lives in mpesa/tests/items/{checkoutRequestId}, never in
 * mpesa/transactions, so nothing that posts money ever sees it.
 */

const DOC = 'config/mpesaStatus';
const CACHE_MS = 30_000;
export const MODES = ['off', 'demo', 'live'];
export const TEST_TIMEOUT_MS = 2 * 60_000;
export const QUERY_AFTER_MS = 20_000;
// 013Fixes / 32: at most one status query to Safaricom this often.
export const QUERY_EVERY_MS = 25_000;
export const TIMEOUT_MESSAGE = 'No answer from M-Pesa within 2 minutes. Try again.';

let cache = null; // { at, value }
export function invalidateMpesaStatus() { cache = null; }
export const __resetMpesaStatus = invalidateMpesaStatus;

const toMs = (t) => (t?.toMillis ? t.toMillis() : t instanceof Date ? t.getTime() : null);

/** "+2547••••0123": enough to recognise the phone, never the whole number. */
export function maskPhone(phone) {
  const p = String(phone ?? '');
  return p.length > 8 ? `${p.slice(0, 5)}••••${p.slice(-4)}` : '••••';
}

/** The stored state (cached CACHE_MS per isolate; `fresh` reads now). */
export async function readMpesaStatus(db = getDb(), { fresh = false, now = Date.now() } = {}) {
  if (!fresh && cache && now - cache.at < CACHE_MS) return cache.value;
  const snap = await db.doc(DOC).get();
  const value = snap.exists ? snap.data() : {};
  cache = { at: now, value };
  return value;
}

export const modeOf = (s) => (MODES.includes(s?.mode) ? s.mode : 'off');

/** Live is tested while the live keys in use have the confirmed fingerprint. */
export const isLiveTested = (s, currentFingerprint) => Boolean(currentFingerprint) && s?.testedFingerprint === currentFingerprint;

/** What the superadmin card shows. */
export function statusView(s = {}, currentFingerprint = null) {
  const mode = modeOf(s);
  return {
    mode,
    liveTested: isLiveTested(s, currentFingerprint),
    testPending: Boolean(s.testCheckoutId),
    testStartedAt: s.testCheckoutId ? toMs(s.testStartedAt) : null,
    testedAt: toMs(s.testedAt),
    testPhoneMasked: s.testPhoneMasked ?? null,
    lastError: s.lastError ?? null,
  };
}

/** The setting. Doesn't touch "tested": that belongs to the keys. */
export async function setMode(db, mode) {
  await db.doc(DOC).set({ mode, lastError: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  invalidateMpesaStatus();
}

/** A test push went out (live keys with this fingerprint). */
export async function beginTest(db, { checkoutRequestId, phoneMasked, fingerprint, now = Date.now() }) {
  await db.doc(DOC).set({
    testCheckoutId: checkoutRequestId, testFingerprint: fingerprint, testStartedAt: new Date(now),
    testPhoneMasked: phoneMasked, lastError: null, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  invalidateMpesaStatus();
}

/**
 * A test's outcome (Safaricom's callback, the status query, or the timeout).
 * Tested only when it is the test in flight AND the live keys in use now are
 * the ones it was made with (`currentFingerprint`), decided in a transaction.
 * @returns {Promise<{applied: boolean, tested: boolean}>}
 */
export async function settleTest(db, { checkoutRequestId, resultCode, resultDesc = null, timedOut = false, currentFingerprint = null, now = Date.now() }) {
  const outcome = timedOut ? { status: 'timeout', userFacing: TIMEOUT_MESSAGE } : interpretResultCode(resultCode);
  const success = outcome.status === 'success';
  const testRef = db.doc(`mpesa/tests/items/${checkoutRequestId}`);
  const result = await db.runTransaction(async (tx) => {
    const ref = db.doc(DOC);
    const [snap, testSnap] = await Promise.all([tx.get(ref), tx.get(testRef)]);
    const s = snap.exists ? snap.data() : {};
    if (testSnap.exists && testSnap.data().status === 'pending') {
      tx.set(testRef, {
        status: timedOut ? 'timeout' : outcome.status, resultCode: timedOut ? null : (resultCode ?? null),
        resultDesc: resultDesc ?? null, completedAt: new Date(now),
      }, { merge: true });
    }
    if (s.testCheckoutId !== checkoutRequestId) return { applied: false, tested: false };
    const sameKeys = Boolean(currentFingerprint) && s.testFingerprint === currentFingerprint;
    const tested = success && sameKeys;
    tx.set(ref, {
      testCheckoutId: null,
      testFingerprint: null,
      ...(tested ? { testedFingerprint: currentFingerprint, testedAt: new Date(now), lastError: null } : {
        lastError: success ? 'The keys changed during the test. Run it again.' : outcome.userFacing,
      }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { applied: true, tested };
  });
  invalidateMpesaStatus();
  return result;
}
