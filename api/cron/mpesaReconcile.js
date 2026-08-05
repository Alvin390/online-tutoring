import { randomUUID } from 'node:crypto';
import { createLogger } from '../_lib/log.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { safeCompare } from '../_lib/crypto.js';
import { isEnabled } from '../_lib/flags.js';
import { loadCredentials, queryStkStatus, interpretResultCode } from '../_lib/daraja.js';
import { postEntry } from '../_lib/ledger.js';
import { shouldAutoUnblock } from '../_lib/feeState.js';
import { tryWriteAudit } from '../_lib/audit.js';

/**
 * M-Pesa reconciliation sweep — Phase 09 D5.
 *
 * CALLBACKS GET LOST. A network blip, a cold start that times out, a Safaricom
 * incident — and a payment the parent has made and been charged for never
 * reaches the ledger. That is the worst failure mode in this entire system,
 * because the student stays blocked after paying and nobody can explain why.
 *
 * So there are three independent safety nets. This is nets 1 and 2:
 *
 *   1. Transactions pending longer than 2 minutes are actively queried.
 *   2. Anything still pending after 24 hours is resolved or marked failed.
 *
 * Net 3 is the manual reconciliation UI, where the teacher attaches an
 * unmatched payment to a student by hand. That one matters most: payments will
 * arrive with mistyped references, and the teacher needs a way to fix it
 * without a developer.
 *
 * Runs even when `payments.daraja` is off — see the note in the callback
 * handler. Disabling the feature must not strand real money.
 */

export const config = { maxDuration: 60 };

const QUERY_AFTER_MS = 2 * 60 * 1000;
const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 25;

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const explicit = req.headers['x-cron-secret'];

  return (
    (bearer != null && safeCompare(bearer, secret))
    || (typeof explicit === 'string' && safeCompare(explicit, secret))
  );
}

export default async function handler(req, res) {
  const requestId = randomUUID();
  const log = createLogger(requestId);

  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!authorized(req)) {
    log.warn('Unauthorized reconciliation invocation');
    return res.status(401).json({ error: { code: 'unauthorized' } });
  }

  const db = getDb();
  const now = Date.now();
  const result = { queried: 0, resolved: 0, abandoned: 0, posted: 0 };

  try {
    const pending = await db
      // Three segments — a COLLECTION path must have an odd segment count,
      // which is the mirror of the document rule above.
      .collection('mpesa/transactions/items')
      .where('status', '==', 'pending')
      .limit(MAX_PER_RUN)
      .get();

    if (pending.empty) {
      return res.status(200).json({ ok: true, ...result, note: 'nothing pending' });
    }

    let credentials = null;
    try {
      credentials = await loadCredentials();
    } catch (err) {
      log.warn('Cannot reconcile: Daraja credentials unavailable', { code: err?.code });
      return res.status(200).json({ ok: true, ...result, skipped: 'no_credentials' });
    }

    for (const docSnap of pending.docs) {
      const tx = docSnap.data();
      const initiatedAt = tx.initiatedAt?.toMillis?.() ?? now;
      const age = now - initiatedAt;

      if (age < QUERY_AFTER_MS) continue;

      // Net 2: give up on anything ancient, so the list does not grow forever.
      if (age > ABANDON_AFTER_MS) {
        // eslint-disable-next-line no-await-in-loop
        await docSnap.ref.set(
          {
            status: 'abandoned',
            resultDesc: 'No response from M-Pesa within 24 hours.',
            completedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        result.abandoned += 1;
        continue;
      }

      // Net 1: actively ask Daraja what happened.
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await queryStkStatus({
          credentials,
          checkoutRequestId: tx.checkoutRequestId,
        });
        result.queried += 1;

        const resultCode = response?.ResultCode;
        if (resultCode === undefined || resultCode === null) continue;

        const outcome = interpretResultCode(resultCode);

        if (outcome.status !== 'success') {
          // eslint-disable-next-line no-await-in-loop
          await docSnap.ref.set(
            {
              status: outcome.status,
              resultCode,
              resultDesc: response.ResultDesc ?? null,
              resolvedBy: 'reconciliation',
              completedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          result.resolved += 1;
          continue;
        }

        // Success that never reached us as a callback. Post it.
        //
        // The status query does NOT return the M-Pesa receipt number or the
        // amount — it reports only the result code — so the amount comes from
        // our own initiating record. That is the safe direction: we post what
        // we asked for, which Daraja has now confirmed was paid.
        // eslint-disable-next-line no-await-in-loop
        const posted = await postEntry({
          phone: tx.phone,
          session: tx.session,
          type: 'payment',
          amount: tx.expectedAmount,
          method: 'mpesa',
          reference: null,
          note: 'Recovered by reconciliation — callback not received',
          recordedBy: 'system:daraja-reconcile',
          idempotencyKey: `mpesa_${tx.checkoutRequestId}`,
        });

        // eslint-disable-next-line no-await-in-loop
        await docSnap.ref.set(
          {
            status: 'success',
            resultCode: 0,
            ledgerEntryId: posted.entryId,
            balanceAfter: posted.balance,
            resolvedBy: 'reconciliation',
            completedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        if (!posted.duplicate) result.posted += 1;
        result.resolved += 1;

        if (!posted.duplicate && shouldAutoUnblock(posted.balance)) {
          const studentRef = db.doc(`sessions/${tx.session}/students/${tx.phone}`);
          // eslint-disable-next-line no-await-in-loop
          const studentSnap = await studentRef.get();
          if (studentSnap.exists && studentSnap.data().blocked === true) {
            // eslint-disable-next-line no-await-in-loop
            await studentRef.set(
              { blocked: false, blockReason: '', blockedAt: null },
              { merge: true }
            );
          }
        }

        // eslint-disable-next-line no-await-in-loop
        await tryWriteAudit(
          {
            action: 'payments.recovered_by_reconciliation',
            actor: 'system:daraja-reconcile',
            target: `${tx.session}/${tx.phone}`,
            after: { amount: tx.expectedAmount, balance: posted.balance },
            context: { requestId, checkoutRequestId: tx.checkoutRequestId },
          },
          log
        );
      } catch (err) {
        // One bad transaction must not stop the sweep.
        log.warn('Reconciliation query failed for one transaction', {
          checkoutRequestId: tx.checkoutRequestId,
          code: err?.code,
        });
      }
    }

    log.info('M-Pesa reconciliation complete', result);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    log.error('M-Pesa reconciliation failed', err);
    return res.status(500).json({ error: { code: 'reconcile_failed' } });
  }
}
