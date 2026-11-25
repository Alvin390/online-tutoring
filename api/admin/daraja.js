import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema } from '../_lib/validate.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { ApiError } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';
import { schoolPlan } from '../_lib/schoolPlan.js';
import {
  _resetTokenCache, credentialSource, loadCredentials, credentialsFingerprint, callbackModeFor,
  initiateStkPush, queryStkStatus, toDarajaPhone, ensureCallbackSecret, buildCallbackUrl, callbackBaseUrl, stkCallbackUrl,
} from '../_lib/daraja.js';
import {
  MODES, readMpesaStatus, statusView, modeOf, setMode, beginTest, settleTest, maskPhone,
  QUERY_AFTER_MS, QUERY_EVERY_MS, TEST_TIMEOUT_MS,
} from '../_lib/mpesaStatus.js';
import { keysView, saveKeys, clearKeys, SECRET_FIELDS } from '../_lib/darajaKeys.js';

/**
 * Superadmin → M-Pesa payments (STK) — 013Fixes / 29-30b (owner answer 5;
 * owner, 2026-11-25: Off / Demo / Live).
 *
 *   status      the setting, the live keys (last 4 only), whether Live is
 *               tested, and whether sandbox and live keys are present
 *   setMode     'off' | 'demo' | 'live' (audited). Doesn't touch "tested":
 *               that belongs to the live keys
 *   save/clear  the school's LIVE keys, encrypted, write-only, audited
 *               without values. Changing them makes Live untested (their
 *               fingerprint no longer matches the confirmed test)
 *   testPush    Live only: KES 1 to a phone you type, with the live keys;
 *               kept in mpesa/tests, never a payment
 *   testResult  the test's outcome: Safaricom's callback, or after 20 s its
 *               status query (at most every 25 s); 2 minutes = timed out
 */

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({
    action: z.literal('save'),
    consumerKey: z.string().trim().min(1).max(200),
    consumerSecret: z.string().trim().min(1).max(200),
    passkey: z.string().trim().min(1).max(300),
    // A wrong type means the prompt never reaches the phone (docs/STK_PUSH_PILOT.md).
    shortCode: z.string().trim().regex(/^\d{5,8}$/, 'The till or paybill number is 5 to 8 digits.'),
    shortCodeType: z.enum(['till', 'paybill']),
  }).strict(),
  z.object({ action: z.literal('clear') }).strict(),
  z.object({ action: z.literal('setMode'), mode: z.enum(MODES) }).strict(),
  z.object({ action: z.literal('testPush'), phone: phoneSchema }).strict(),
  z.object({ action: z.literal('testResult') }).strict(),
]);

const liveKeys = () => loadCredentials({ environment: 'production' }).catch(() => null);

async function view(db) {
  const [live, sandboxSource, liveSource, keys, status, flagOn, plan] = await Promise.all([
    liveKeys(),
    credentialSource({ environment: 'sandbox' }).catch(() => null),
    credentialSource({ environment: 'production' }).catch(() => null),
    keysView(db),
    readMpesaStatus(db, { fresh: true }),
    isEnabled('payments.daraja'),
    schoolPlan(db).catch(() => null),
  ]);
  return {
    keys,
    sources: { sandbox: sandboxSource, live: liveSource },
    mpesa: statusView(status, credentialsFingerprint(live)),
    // What else students need for Pay now (shown on the card, not changed there).
    ready: { flag: flagOn, gold: plan?.features?.mpesaStk === true },
  };
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  // 013Fixes / 32: the card polls the test's result (a read) every 10 s.
  rateLimit: { bucket: 'admin_daraja', limit: 300, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log, waitUntil }) => {
    const db = getDb();
    const audit = (action, extra = {}) => waitUntil(tryWriteAudit({
      action, actor: user.uid, actorRole: user.role, target: 'config/mpesaStatus', ...extra, context: { requestId: log.requestId },
    }, log));

    if (body.action === 'status') return view(db);

    if (body.action === 'setMode') {
      const before = modeOf(await readMpesaStatus(db, { fresh: true }));
      await setMode(db, body.mode);
      audit('mpesa.mode_changed', { before: { mode: before }, after: { mode: body.mode } });
      log.info('M-Pesa mode', { mode: body.mode });
      return { ok: true, ...(await view(db)) };
    }

    if (body.action === 'save') {
      await saveKeys(db, body, user.uid);
      // A token issued for the old keys must not be reused with the new ones.
      _resetTokenCache();
      // Which fields and the type; never a value, not even the last 4.
      audit('mpesa.keys_saved', { target: 'config/darajaCredentials', after: { fields: SECRET_FIELDS, shortCodeType: body.shortCodeType } });
      log.info('M-Pesa keys saved', { shortCodeType: body.shortCodeType });
      return { ok: true, ...(await view(db)) };
    }

    if (body.action === 'clear') {
      await clearKeys(db);
      _resetTokenCache();
      audit('mpesa.keys_cleared', { target: 'config/darajaCredentials' });
      log.info('M-Pesa keys cleared');
      return { ok: true, ...(await view(db)) };
    }

    if (body.action === 'testPush') return testPush({ db, body, log, audit });

    return testResult({ db, log });
  },
});

/** Live only: KES 1 to the phone typed, with the school's live keys. */
async function testPush({ db, body, log, audit }) {
  const status = await readMpesaStatus(db, { fresh: true });
  if (modeOf(status) !== 'live') {
    throw new ApiError(409, 'live_only', 'The test payment is for Live: choose Live first.');
  }
  const credentials = await loadCredentials({ environment: 'production' });
  const payer = toDarajaPhone(body.phone);
  if (!payer) throw new ApiError(400, 'invalid_phone', 'That phone number is not valid for M-Pesa.');

  const cbMode = callbackModeFor(credentials.environment);
  const realCallbackUrl = buildCallbackUrl(callbackBaseUrl(), await ensureCallbackSecret(db), { mode: cbMode });
  const { url: callbackUrl } = stkCallbackUrl(realCallbackUrl, { mode: cbMode });
  const response = await initiateStkPush({
    credentials, amount: 1, payerPhone: payer, accountReference: 'TEST', description: 'Test', callbackUrl,
  });
  const checkoutRequestId = response?.CheckoutRequestID;
  if (!checkoutRequestId) throw new ApiError(502, 'stk_rejected', 'M-Pesa did not accept the test. Check the keys and try again.');

  const phoneMasked = maskPhone(body.phone);
  // Apart from real payments: nothing that posts money reads this collection.
  await db.doc(`mpesa/tests/items/${checkoutRequestId}`).set({
    checkoutRequestId, amount: 1, phoneMasked, environment: credentials.environment, source: credentials.source,
    status: 'pending', resultCode: null, resultDesc: null, startedAt: new Date(), completedAt: null,
  });
  await beginTest(db, { checkoutRequestId, phoneMasked, fingerprint: credentialsFingerprint(credentials) });
  audit('mpesa.test_started', { after: { phoneMasked, environment: credentials.environment } });
  log.info('M-Pesa test push sent', { environment: credentials.environment });
  return { ok: true, checkoutRequestId, message: 'Check the phone for the M-Pesa prompt (KES 1).', ...(await view(db)) };
}

/** The test's outcome — asks Safaricom after 20 s (at most every 25 s); 2 minutes = timed out. */
async function testResult({ db, log }) {
  const status = await readMpesaStatus(db, { fresh: true });
  const id = status.testCheckoutId;
  if (id) {
    const toMs = (t) => t?.toMillis?.() ?? (t instanceof Date ? t.getTime() : 0);
    const age = Date.now() - toMs(status.testStartedAt);
    const live = await liveKeys();
    const currentFingerprint = credentialsFingerprint(live);
    let settled = false;
    if (live && age >= QUERY_AFTER_MS && Date.now() - toMs(status.testLastQueriedAt) >= QUERY_EVERY_MS) {
      await db.doc('config/mpesaStatus').set({ testLastQueriedAt: new Date() }, { merge: true });
      try {
        const response = await queryStkStatus({ credentials: live, checkoutRequestId: id });
        const code = response?.ResultCode;
        if (code !== undefined && code !== null && code !== '') {
          await settleTest(db, { checkoutRequestId: id, resultCode: code, resultDesc: response?.ResultDesc ?? null, currentFingerprint });
          settled = true;
        }
      } catch (err) {
        // "Still being processed", or Safaricom unreachable: ask again on a later check.
        log.info('M-Pesa test status not final yet', { code: err?.code ?? null });
      }
    }
    if (!settled && age >= TEST_TIMEOUT_MS) {
      await settleTest(db, { checkoutRequestId: id, timedOut: true, currentFingerprint });
    }
  }
  return { ok: true, ...(await view(db)) };
}
