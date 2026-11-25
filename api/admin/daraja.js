import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { darajaMode } from '../_lib/mode.js';
import { ApiError } from '../_lib/errors.js';
import { phoneSchema } from '../_lib/validate.js';
import { isEnabled } from '../_lib/flags.js';
import { schoolPlan } from '../_lib/schoolPlan.js';
import {
  _resetTokenCache, credentialSource, loadCredentials, initiateStkPush, queryStkStatus, toDarajaPhone,
  ensureCallbackSecret, buildCallbackUrl, callbackBaseUrl, stkCallbackUrl,
} from '../_lib/daraja.js';
import {
  readMpesaStatus, statusView, setSwitch, markKeysChanged, beginTest, settleTest, maskPhone,
  QUERY_AFTER_MS, QUERY_EVERY_MS, TEST_TIMEOUT_MS,
} from '../_lib/mpesaStatus.js';
import { keysView, saveKeys, clearKeys, SECRET_FIELDS } from '../_lib/darajaKeys.js';

/**
 * Superadmin → M-Pesa payments (STK) — 013Fixes / 29 (owner answer 5).
 *
 *   status  the mode, where the keys in use come from, and the saved keys as
 *           the last 4 characters of each and when (never a value)
 *   save    the school's LIVE keys, encrypted; write-only; audited without values
 *   clear   remove them (live mode falls back to the environment's, if any)
 *
 * 013Fixes / 30 (owner answer 5):
 *   setEnabled  the switch; off = hidden everywhere
 *   testPush    KES 1 to a phone you type (the school's own till or paybill);
 *               kept in mpesa/tests, never a payment
 *   testResult  the test's outcome: Safaricom's callback, or after 20 s its
 *               status query; no answer in 2 minutes = timed out
 * Any change to the keys or the switch turns it offline until a new test passes.
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
  z.object({ action: z.literal('setEnabled'), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('testPush'), phone: phoneSchema }).strict(),
  z.object({ action: z.literal('testResult') }).strict(),
]);

async function view(db, { fresh = true } = {}) {
  const [source, keys, status, flagOn, plan] = await Promise.all([
    credentialSource().catch(() => null),
    keysView(db),
    readMpesaStatus(db, { fresh }),
    isEnabled('payments.daraja'),
    schoolPlan(db).catch(() => null),
  ]);
  return {
    mode: darajaMode(), source, keys,
    mpesa: statusView(status),
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

    if (body.action === 'status') return view(db);

    if (body.action === 'save') {
      await saveKeys(db, body, user.uid);
      // A token issued for the old keys must not be reused with the new ones.
      _resetTokenCache();
      await markKeysChanged(db);
      waitUntil(tryWriteAudit({
        action: 'mpesa.keys_saved', actor: user.uid, actorRole: user.role, target: 'config/darajaCredentials',
        // Which fields and the type; never a value, not even the last 4.
        after: { fields: SECRET_FIELDS, shortCodeType: body.shortCodeType }, context: { requestId: log.requestId },
      }, log));
      log.info('M-Pesa keys saved', { shortCodeType: body.shortCodeType });
      return { ok: true, ...(await view(db)) };
    }

    if (body.action === 'setEnabled') {
      await setSwitch(db, body.enabled);
      waitUntil(tryWriteAudit({
        action: body.enabled ? 'mpesa.switched_on' : 'mpesa.switched_off', actor: user.uid, actorRole: user.role,
        target: 'config/mpesaStatus', context: { requestId: log.requestId },
      }, log));
      log.info('M-Pesa switch', { enabled: body.enabled });
      return { ok: true, ...(await view(db)) };
    }

    if (body.action === 'testPush') return testPush({ db, body, user, log, waitUntil });

    if (body.action === 'testResult') return testResult({ db, log });

    // clear
    await clearKeys(db);
    _resetTokenCache();
    await markKeysChanged(db);
    waitUntil(tryWriteAudit({
      action: 'mpesa.keys_cleared', actor: user.uid, actorRole: user.role, target: 'config/darajaCredentials',
      context: { requestId: log.requestId },
    }, log));
    log.info('M-Pesa keys cleared');
    return { ok: true, ...(await view(db)) };
  },
});

/** 013Fixes / 30: KES 1 to the phone typed, through the school's own till or paybill. */
async function testPush({ db, body, user, log, waitUntil }) {
  const status = await readMpesaStatus(db, { fresh: true });
  if (status.enabled !== true) throw new ApiError(409, 'mpesa_off', 'Switch M-Pesa payments on first.');
  const credentials = await loadCredentials();
  const payer = toDarajaPhone(body.phone);
  if (!payer) throw new ApiError(400, 'invalid_phone', 'That phone number is not valid for M-Pesa.');

  const realCallbackUrl = buildCallbackUrl(callbackBaseUrl(), await ensureCallbackSecret(db));
  const { url: callbackUrl } = stkCallbackUrl(realCallbackUrl);
  const response = await initiateStkPush({
    credentials, amount: 1, payerPhone: payer, accountReference: 'TEST', description: 'Test', callbackUrl,
  });
  const checkoutRequestId = response?.CheckoutRequestID;
  if (!checkoutRequestId) throw new ApiError(502, 'stk_rejected', 'M-Pesa did not accept the test. Check the keys and try again.');

  const phoneMasked = maskPhone(body.phone);
  // Apart from real payments: nothing that posts money reads this collection.
  await db.doc(`mpesa/tests/items/${checkoutRequestId}`).set({
    checkoutRequestId, amount: 1, phoneMasked, environment: credentials.environment, source: credentials.source,
    status: 'pending', resultCode: null, resultDesc: null, startedAt: new Date(), completedAt: null, actor: user.uid,
  });
  await beginTest(db, { checkoutRequestId, phoneMasked });
  waitUntil(tryWriteAudit({
    action: 'mpesa.test_started', actor: user.uid, actorRole: user.role, target: 'config/mpesaStatus',
    after: { phoneMasked, environment: credentials.environment }, context: { requestId: log.requestId },
  }, log));
  log.info('M-Pesa test push sent', { environment: credentials.environment });
  return { ok: true, checkoutRequestId, message: 'Check the phone for the M-Pesa prompt (KES 1).', ...(await view(db)) };
}

/** 013Fixes / 30: the test's outcome — asks Safaricom after 20 s; 2 minutes = timed out. */
async function testResult({ db, log }) {
  const status = await readMpesaStatus(db, { fresh: true });
  const id = status.testCheckoutId;
  if (id) {
    const started = status.testStartedAt?.toMillis?.() ?? (status.testStartedAt instanceof Date ? status.testStartedAt.getTime() : 0);
    const age = Date.now() - started;
    let settled = false;
    // 013Fixes / 32: Safaricom is asked at most every QUERY_EVERY_MS, however
    // often the card polls (or how many tabs are open).
    const lastQueried = status.testLastQueriedAt?.toMillis?.() ?? (status.testLastQueriedAt instanceof Date ? status.testLastQueriedAt.getTime() : 0);
    if (age >= QUERY_AFTER_MS && Date.now() - lastQueried >= QUERY_EVERY_MS) {
      await db.doc('config/mpesaStatus').set({ testLastQueriedAt: new Date() }, { merge: true });
      try {
        const response = await queryStkStatus({ credentials: await loadCredentials(), checkoutRequestId: id });
        const code = response?.ResultCode;
        if (code !== undefined && code !== null && code !== '') {
          await settleTest(db, { checkoutRequestId: id, resultCode: code, resultDesc: response?.ResultDesc ?? null });
          settled = true;
        }
      } catch (err) {
        // "Still being processed", or Safaricom unreachable: ask again on the next check.
        log.info('M-Pesa test status not final yet', { code: err?.code ?? null });
      }
    }
    if (!settled && age >= TEST_TIMEOUT_MS) {
      await settleTest(db, { checkoutRequestId: id, timedOut: true });
    }
  }
  return { ok: true, ...(await view(db)) };
}
