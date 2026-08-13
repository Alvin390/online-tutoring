import { randomUUID } from 'node:crypto';
import { createLogger } from '../../_lib/log.js';
import { readRawBody } from '../../_lib/handler.js';
import { getDb, FieldValue } from '../../_lib/firebaseAdmin.js';
import { safeCompare } from '../../_lib/crypto.js';
import { isSafaricomIp, parseCallbackMetadata, interpretResultCode } from '../../_lib/daraja.js';
import { fromDarajaAmount, parseDarajaTimestamp } from '../../_lib/money.js';
import { clientIp } from '../../_lib/rateLimit.js';
import { postEntry } from '../../_lib/ledger.js';
import { shouldAutoUnblock } from '../../_lib/feeState.js';
import { tryWriteAudit } from '../../_lib/audit.js';

/**
 * M-Pesa callback — Phase 09 D4. The endpoint Safaricom calls.
 *
 * DARAJA CALLBACKS ARE UNSIGNED. There is no HMAC, no shared secret and no
 * signature header anywhere in the specification — unlike the Paystack webhook
 * in Phase 03, which can be cryptographically verified. So the controls here
 * are different in kind, and layered:
 *
 *   1. **IP allowlist** — the primary control, since nothing can be verified
 *      cryptographically.
 *   2. **Unguessable path segment** — this file is `[secret].js`, and the
 *      segment is a 16-byte random token stored with the credentials. Defence
 *      in depth: an attacker who spoofs an IP still needs the URL.
 *   3. **Amount cross-check** against the initiating record. The callback's
 *      amount is NEVER trusted on its own — a forged callback claiming
 *      KES 3,000 against a KES 1 push would otherwise clear a real balance.
 *   4. **Idempotency** on `CheckoutRequestID`. Safaricom retries.
 *
 * Always responds `{"ResultCode": 0, "ResultDesc": "Accepted"}` quickly, per
 * Daraja's expectation. Returning an error makes Safaricom retry indefinitely.
 *
 * NOTE: this endpoint deliberately stays live even when `payments.daraja` is
 * off. Disabling it would silently lose in-flight real money.
 */

export const config = {
  api: { bodyParser: false },
};

/** Daraja expects this exact shape, and treats anything else as a failure. */
const ACCEPTED = { ResultCode: 0, ResultDesc: 'Accepted' };

export default async function handler(req, res) {
  const requestId = randomUUID();
  const log = createLogger(requestId);

  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ResultCode: 1, ResultDesc: 'Method not allowed' });
  }

  const ip = clientIp(req);

  // --- 1. IP allowlist.
  if (!isSafaricomIp(ip)) {
    log.warn('M-Pesa callback from unexpected IP', { ip });

    await tryWriteAudit(
      { action: 'payments.callback_rejected', actor: 'unknown',
        context: { reason: 'ip_not_allowed', ip, requestId } },
      log
    );

    // 403 with no detail. An attacker probing this endpoint learns nothing
    // about whether the path segment was right.
    return res.status(403).json({ ResultCode: 1, ResultDesc: 'Rejected' });
  }

  // --- 2. Path secret, compared in constant time.
  const db = getDb();
  const integrationSnap = await db.doc('integrations/daraja').get();
  const expectedSecret = integrationSnap.exists ? integrationSnap.data().callbackSecret : null;
  const providedSecret = req.query?.secret ?? '';

  if (!expectedSecret || !safeCompare(providedSecret, expectedSecret)) {
    log.warn('M-Pesa callback with a bad path secret', { ip });
    return res.status(403).json({ ResultCode: 1, ResultDesc: 'Rejected' });
  }

  let payload;
  try {
    const raw = await readRawBody(req);
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    log.warn('M-Pesa callback with unparseable body');
    // Still 200: a malformed body is not something Safaricom should retry.
    return res.status(200).json(ACCEPTED);
  }

  const callback = payload?.Body?.stkCallback;
  if (!callback?.CheckoutRequestID) {
    log.warn('M-Pesa callback missing stkCallback');
    return res.status(200).json(ACCEPTED);
  }

  const checkoutRequestId = String(callback.CheckoutRequestID);
  // Four segments — a document path must have an even segment count.
  const txRef = db.doc(`mpesa/transactions/items/${checkoutRequestId}`);

  try {
    const txSnap = await txRef.get();

    if (!txSnap.exists) {
      // A callback for a transaction we never initiated. Recorded as unmatched
      // for the manual reconciliation UI rather than dropped — this is exactly
      // the case a teacher needs to be able to fix by hand.
      log.warn('M-Pesa callback for an unknown transaction', { checkoutRequestId });
      await db.doc(`mpesa/unmatched/items/${checkoutRequestId}`).set({
        checkoutRequestId,
        raw: payload,
        receivedAt: FieldValue.serverTimestamp(),
        requestId,
      });
      return res.status(200).json(ACCEPTED);
    }

    const tx = txSnap.data();

    // --- 4. Idempotency. Safaricom retries; a duplicate must be a no-op.
    if (tx.status !== 'pending') {
      log.info('Duplicate M-Pesa callback ignored', { checkoutRequestId, status: tx.status });
      return res.status(200).json(ACCEPTED);
    }

    const outcome = interpretResultCode(callback.ResultCode);

    // --- Failure paths. Recorded with their real reason: a cancelled prompt is
    // a normal outcome, not an error, and showing it as "failed" makes a
    // dashboard look broken when a parent simply changed their mind.
    if (outcome.status !== 'success') {
      await txRef.set(
        {
          status: outcome.status,
          resultCode: callback.ResultCode ?? null,
          resultDesc: callback.ResultDesc ?? null,
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      log.info('M-Pesa payment did not complete', {
        checkoutRequestId,
        outcome: outcome.status,
        resultCode: callback.ResultCode,
      });

      return res.status(200).json(ACCEPTED);
    }

    // --- Success.
    const metadata = parseCallbackMetadata(callback);
    const amount = fromDarajaAmount(metadata.Amount);
    const receipt = metadata.MpesaReceiptNumber ?? null;
    const paidAt = parseDarajaTimestamp(metadata.TransactionDate) ?? new Date();

    // --- 3. Amount cross-check. NEVER trust the callback's amount alone.
    if (amount !== tx.expectedAmount) {
      log.error('M-Pesa callback amount does not match the initiating record', {
        checkoutRequestId,
        expected: tx.expectedAmount,
        received: amount,
      });

      await txRef.set(
        {
          status: 'amount_mismatch',
          resultCode: callback.ResultCode ?? null,
          receivedAmount: amount,
          mpesaReceipt: receipt,
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await tryWriteAudit(
        {
          action: 'payments.amount_mismatch',
          actor: 'system:daraja',
          target: `${tx.session}/${tx.phone}`,
          before: { expected: tx.expectedAmount },
          after: { received: amount, receipt },
          context: { requestId, checkoutRequestId },
        },
        log
      );

      // Flagged for manual reconciliation, NOT posted. Money may genuinely have
      // moved, so it is surfaced to the teacher rather than silently discarded
      // — but it is not posted automatically against a figure we did not
      // authorise.
      return res.status(200).json(ACCEPTED);
    }

    // --- Post to the Phase 06 ledger.
    //
    // Idempotency key is the CheckoutRequestID, so even if this whole handler
    // runs twice past the status guard, the ledger entry is written once.
    const posted = await postEntry({
      phone: tx.phone,
      session: tx.session,
      type: 'payment',
      amount,
      method: 'mpesa',
      reference: receipt,
      note: 'Paid in-app via M-Pesa',
      occurredAt: paidAt,
      recordedBy: 'system:daraja',
      idempotencyKey: `mpesa_${checkoutRequestId}`,
    });

    await txRef.set(
      {
        status: 'success',
        resultCode: 0,
        resultDesc: callback.ResultDesc ?? null,
        mpesaReceipt: receipt,
        receivedAmount: amount,
        ledgerEntryId: posted.entryId,
        balanceAfter: posted.balance,
        completedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // --- Auto-unblock, which is precisely the Phase 06 D5 rule reached
    // automatically. A PARTIAL payment leaves the student blocked, and the
    // derived block reason updates itself to the new, smaller balance.
    let unblocked = false;
    if (!posted.duplicate && shouldAutoUnblock(posted.balance)) {
      const studentRef = db.doc(`sessions/${tx.session}/students/${tx.phone}`);
      const studentSnap = await studentRef.get();

      if (studentSnap.exists && studentSnap.data().blocked === true) {
        await studentRef.set(
          {
            blocked: false,
            blockReason: '',
            blockedAt: null,
            unblockedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        unblocked = true;
      }
    }

    log.info('M-Pesa payment posted', {
      checkoutRequestId,
      amount,
      balance: posted.balance,
      unblocked,
      duplicate: posted.duplicate,
    });

    await tryWriteAudit(
      {
        action: 'payments.received',
        actor: 'system:daraja',
        target: `${tx.session}/${tx.phone}`,
        after: { amount, balance: posted.balance, entryId: posted.entryId, unblocked },
        context: { requestId, checkoutRequestId },
      },
      log
    );

    return res.status(200).json(ACCEPTED);
  } catch (err) {
    log.error('M-Pesa callback processing failed', err);

    // 200 even on failure. The transaction stays 'pending' and the
    // reconciliation sweep in Phase 09 D5 resolves it via the status query.
    // Making Safaricom retry a poison callback forever is worse.
    return res.status(200).json(ACCEPTED);
  }
}
