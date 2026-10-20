import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { authenticate } from '../_lib/auth.js';
import { badRequest, forbidden, notFound } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { accountRef } from '../_lib/ledger.js';
import {
  loadCredentials,
  initiateStkPush,
  toDarajaPhone,
  ensureCallbackSecret,
  buildCallbackUrl,
  callbackBaseUrl,
  isUnreachableCallback,
  stkCallbackUrl,
} from '../_lib/daraja.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { mpesaAvailability } from '../_lib/mpesaAvailability.js';

/**
 * STK Push initiation — Phase 09 D3.
 *
 * THE AMOUNT IS DERIVED SERVER-SIDE FROM THE LEDGER, NEVER TAKEN FROM THE
 * REQUEST BODY. The schema is `.strict()`, so a body carrying `amount` is
 * rejected outright rather than ignored — a client that could name its own
 * amount could pay KES 1 against a KES 3,000 balance and have the block lift.
 *
 * A partial amount IS allowed (Phase 06 permits partial payments), but it is
 * chosen from a server-validated range bounded by the actual balance, not
 * asserted by the caller.
 */

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
    // The handset receiving the prompt. Parents often pay from a different
    // phone than the one the student registered with.
    payerPhone: phoneSchema.optional(),
    // Optional partial payment. Validated against the real balance below.
    payAmount: z.number().int().min(1).max(10_000_000).optional(),
  })
  .strict();

export default createHandler({
  // Phase 13 / 02 D6: every session slug in the body must exist and be shown to students.
  sessions: 'active',
  method: 'POST',
  schema,
  rateLimit: { bucket: 'payments_initiate_ip', limit: 20, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, req, log }) => {
    // Flag + Gold plan + credentials — the same rule that decides whether the
    // student screen shows "Pay now" at all (mpesaAvailability).
    const availability = await mpesaAvailability();
    if (availability.reason === 'feature_disabled') {
      throw forbidden('In-app payments are not available.', 'feature_disabled');
    }
    if (availability.reason === 'plan') {
      throw forbidden('M-Pesa payments are not available on this plan. Please pay your teacher and submit the receipt.', 'payments_unavailable');
    }

    const { session, phone } = body;

    // --- Identity. A student may only pay their OWN fees.
    let authorized = false;
    try {
      const user = await authenticate(req);
      if (user.role === 'student' && user.phone === phone) authorized = true;
      if (user.role === 'teacher' || user.role === 'superadmin') authorized = true;
    } catch {
      // Fall through to the legacy path.
    }

    if (!authorized && !(await isEnabled('auth.legacyStudentRead'))) {
      throw forbidden('Please verify your phone number to continue.', 'verification_required');
    }

    // Per-student limit: 3 attempts per 10 minutes. An STK push rings someone's
    // phone; an unbounded endpoint is a way to harass a parent.
    await enforceRateLimit({
      key: phone,
      bucket: 'payments_initiate_student',
      limit: 3,
      windowSeconds: 600,
    });

    const db = getDb();

    const studentSnap = await db.doc(`sessions/${session}/students/${phone}`).get();
    if (!studentSnap.exists) throw notFound('No registration found for that number.');

    // --- The amount, from the ledger.
    const accountSnap = await accountRef(db, phone).get();
    const balance = accountSnap.exists ? (accountSnap.data().balance ?? 0) : 0;

    if (balance <= 0) {
      throw badRequest('There is nothing outstanding on this account.', 'nothing_owed');
    }

    const amount = body.payAmount ?? balance;
    if (amount > balance) {
      throw badRequest(
        `That is more than the outstanding balance of KES ${balance.toLocaleString('en-KE')}.`,
        'amount_exceeds_balance'
      );
    }

    const credentials = await loadCredentials();

    if (!credentials.verifiedAt) {
      throw forbidden(
        'M-Pesa is not finished being set up. Please contact your teacher.',
        'daraja_unverified'
      );
    }

    const payer = toDarajaPhone(body.payerPhone ?? phone);
    if (!payer) throw badRequest('That phone number is not valid for M-Pesa.');

    // Phase 13 / 04 D1: the secret is created on first use (it used to exist
    // only if the credentials form had been submitted — with env credentials
    // this built `…/callback/`, which no route matches), and the URL is checked
    // against the rules Safaricom enforces before an STK push can go out.
    const realCallbackUrl = buildCallbackUrl(callbackBaseUrl(), await ensureCallbackSecret(db));
    // Sandbox + localhost: Safaricom rejects a loopback CallBackURL outright,
    // so a public placeholder is sent instead (see stkCallbackUrl).
    const { url: callbackUrl, placeholder } = stkCallbackUrl(realCallbackUrl);
    if (placeholder || isUnreachableCallback(callbackUrl)) {
      log.warn('STK callback cannot reach this machine — after paying, confirm with `npm run mpesa:reconcile`, or set DARAJA_CALLBACK_BASE_URL to an HTTPS tunnel', { placeholder });
    }

    // AccountReference is the attribution key (Q24) and is capped at 12
    // characters by Daraja (daraja_docs.txt:220). A Kenyan number without the
    // plus is exactly 12 digits, so it fits — but the cap is applied in
    // daraja.js regardless, because a longer country code would silently
    // truncate and break attribution.
    const accountReference = phone.replace(/^\+/, '');

    const response = await initiateStkPush({
      credentials,
      amount,
      payerPhone: payer,
      accountReference,
      description: 'School fees',
      callbackUrl,
    });

    const checkoutRequestId = response?.CheckoutRequestID;
    if (!checkoutRequestId) {
      throw badRequest('M-Pesa did not accept the request. Please try again.', 'stk_rejected');
    }

    // Recorded as pending BEFORE returning, so the callback has something to
    // correlate against even if the response never reaches the browser.
    // `mpesa/transactions/items/{id}` — four segments. A Firestore document
    // path must have an EVEN segment count; appendix A's
    // `mpesa/transactions/{id}` is three and would throw at runtime.
    await db.doc(`mpesa/transactions/items/${checkoutRequestId}`).set({
      checkoutRequestId,
      merchantRequestId: response.MerchantRequestID ?? null,
      phone,
      session,
      payerPhone: payer,
      // The expected amount. The callback's amount is cross-checked against
      // this and never trusted on its own.
      expectedAmount: amount,
      balanceAtInitiation: balance,
      environment: credentials.environment,
      shortCode: credentials.shortCode,
      status: 'pending',
      resultCode: null,
      resultDesc: null,
      mpesaReceipt: null,
      ledgerEntryId: null,
      initiatedAt: FieldValue.serverTimestamp(),
      completedAt: null,
    });

    log.info('STK push initiated', {
      session,
      amount,
      environment: credentials.environment,
    });

    await tryWriteAudit(
      {
        action: 'payments.stk_initiated',
        actor: authorized ? 'student' : 'legacy_student',
        target: `${session}/${phone}`,
        after: { amount, checkoutRequestId },
        context: { requestId: log.requestId, environment: credentials.environment },
      },
      log
    );

    return {
      ok: true,
      checkoutRequestId,
      amount,
      balance,
      // Surfaced so the UI can show an unmissable sandbox banner — a teacher
      // accidentally live in sandbox sees payments silently vanish.
      environment: credentials.environment,
      customerMessage: response.CustomerMessage ?? 'Check your phone for the M-Pesa prompt.',
    };
  },
});
