import { getDb, FieldValue } from './firebaseAdmin.js';
import { interpretResultCode } from './daraja.js';

/**
 * The STK switch and its test — 013Fixes / 30 (owner answer 5, round 3).
 *
 *   config/mpesaStatus = {
 *     enabled         the superadmin's switch (off = hidden everywhere)
 *     online          true only after Safaricom confirmed the KES 1 test
 *     configVersion   bumped by ANY change to the keys or the switch
 *     testCheckoutId, testVersion, testStartedAt, testPhoneMasked   the test in flight
 *     testedAt, lastError
 *   }
 *
 * "Any change to the keys turns it offline until a new test passes": a change
 * bumps configVersion and clears online and the test in flight; a test result
 * marks online only when it is the test in flight AND the version it started
 * with is still current — decided in a transaction, so a change during the
 * test always wins.
 *
 * The test itself lives in mpesa/tests/items/{checkoutRequestId}, never in
 * mpesa/transactions, so nothing that posts money (the callback's payment
 * path, the reconcile sweep, the Fees screens) can ever see it.
 */

const DOC = 'config/mpesaStatus';
const CACHE_MS = 30_000;
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

/** What the superadmin card shows. */
export function statusView(s = {}) {
  return {
    enabled: s.enabled === true,
    online: s.enabled === true && s.online === true,
    testPending: Boolean(s.testCheckoutId),
    testStartedAt: s.testCheckoutId ? toMs(s.testStartedAt) : null,
    testedAt: toMs(s.testedAt),
    testPhoneMasked: s.testPhoneMasked ?? null,
    lastError: s.lastError ?? null,
  };
}

async function change(db, patch) {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(DOC);
    const snap = await tx.get(ref);
    const version = (snap.exists ? snap.data().configVersion ?? 0 : 0) + 1;
    tx.set(ref, {
      ...patch, configVersion: version, online: false, testCheckoutId: null, testVersion: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  invalidateMpesaStatus();
}

/** The switch. Any change (on or off) means offline until a new test passes. */
export const setSwitch = (db, enabled) => change(db, { enabled, lastError: null });

/** The keys were saved or cleared: offline until a new test passes. */
export const markKeysChanged = (db) => change(db, {});

/** A test push went out: it is now the test in flight, at the current version. */
export async function beginTest(db, { checkoutRequestId, phoneMasked, now = Date.now() }) {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(DOC);
    const snap = await tx.get(ref);
    const s = snap.exists ? snap.data() : {};
    tx.set(ref, {
      testCheckoutId: checkoutRequestId, testVersion: s.configVersion ?? 0, testStartedAt: new Date(now),
      testPhoneMasked: phoneMasked, lastError: null, online: false, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  invalidateMpesaStatus();
}

/**
 * A test's outcome (Safaricom's callback, the status query, or the timeout).
 * Online only when it is the test in flight and nothing changed since it began.
 * @returns {Promise<{applied: boolean, online: boolean}>}
 */
export async function settleTest(db, { checkoutRequestId, resultCode, resultDesc = null, timedOut = false, now = Date.now() }) {
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
    if (s.testCheckoutId !== checkoutRequestId) return { applied: false, online: s.online === true };
    const current = (s.testVersion ?? -1) === (s.configVersion ?? 0) && s.enabled === true;
    const online = success && current;
    tx.set(ref, {
      online,
      testCheckoutId: null,
      testVersion: null,
      ...(online ? { testedAt: new Date(now), lastError: null } : {
        lastError: success ? 'The settings changed during the test. Run it again.' : outcome.userFacing,
      }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { applied: true, online };
  });
  invalidateMpesaStatus();
  return result;
}
