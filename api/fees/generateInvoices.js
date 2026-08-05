import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, sessionSchema } from '../_lib/validate.js';
import {
  accountRef,
  ledgerRef,
  invoiceRef,
  nextSequence,
  formatInvoiceNumber,
} from '../_lib/ledger.js';
import { resolveFeeAmount, computeNextDueDate } from '../_lib/feeState.js';
import { DEFAULT_FEE_CONFIG } from './config.js';
import { tryWriteAudit } from '../_lib/audit.js';

/**
 * Monthly invoice generation — Phase 06 D6.
 *
 * Callable by the teacher on demand and by the cron on the billing day. Both
 * routes share this handler so there is one definition of what an invoice run
 * does.
 *
 * TWO CORRECTNESS PROPERTIES THAT ARE EASY TO GET WRONG:
 *
 * 1. **Numbering uses a transactional counter, never `count() + 1`.** Two
 *    invoices generated in the same second would both read N and both write
 *    N+1, producing a duplicate invoice number — which is exactly the kind of
 *    thing an accountant notices and nobody can explain afterwards.
 *
 * 2. **Invoice runs are idempotent per period.** The ledger entry ID is derived
 *    from the phone and the billing period, so running the same month twice
 *    posts nothing the second time. Without that, a cron retry doubles
 *    everyone's fees.
 */

const schema = z
  .object({
    // Defaults to the current month. Explicit form is YYYY-MM.
    period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    sessions: z.array(sessionSchema).max(20).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

function currentPeriod(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Shared by the handler and the cron. */
export async function runInvoiceGeneration({ period, sessions, dryRun = false, actor, log }) {
  const db = getDb();
  const targetPeriod = period ?? currentPeriod();
  const [year] = targetPeriod.split('-').map(Number);

  const configSnap = await db.doc('fees/config').get();
  const config = { ...DEFAULT_FEE_CONFIG, ...(configSnap.exists ? configSnap.data() : {}) };

  const sessionList = sessions ?? ['morning', 'evening'];
  const results = { period: targetPeriod, issued: [], skipped: [], total: 0 };

  for (const session of sessionList) {
    // eslint-disable-next-line no-await-in-loop
    const students = await db.collection(`sessions/${session}/students`).get();

    for (const studentDoc of students.docs) {
      const student = studentDoc.data();
      const phone = studentDoc.id;

      // Only approved, unblocked-by-approval students are billed. Invoicing
      // someone the teacher has not yet accepted would be nonsense.
      if ((student.approvalStatus ?? 'approved') !== 'approved') {
        results.skipped.push({ phone, reason: 'not_approved' });
        // eslint-disable-next-line no-continue
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const accountSnap = await accountRef(db, phone).get();
      const account = accountSnap.exists ? accountSnap.data() : null;

      const amount = resolveFeeAmount({ student, account, config });

      // null means no fee configured for this class. Reported rather than
      // silently invoiced at zero — a KES 0 invoice looks deliberate and hides
      // a setup mistake.
      if (amount === null) {
        results.skipped.push({ phone, reason: 'no_fee_configured', class: student.class ?? null });
        // eslint-disable-next-line no-continue
        continue;
      }

      if (amount === 0) {
        results.skipped.push({ phone, reason: 'zero_fee' });
        // eslint-disable-next-line no-continue
        continue;
      }

      if (dryRun) {
        results.issued.push({ phone, amount, invoiceNumber: '(dry run)' });
        results.total += amount;
        // eslint-disable-next-line no-continue
        continue;
      }

      // Idempotency: same phone + same period = same entry ID.
      const entryId = `invoice_${targetPeriod}`;
      const entryDoc = ledgerRef(db, phone).doc(entryId);

      try {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await db.runTransaction(async (tx) => {
          const existing = await tx.get(entryDoc);
          if (existing.exists) return { duplicate: true };

          const accountNow = await tx.get(accountRef(db, phone));
          const previousBalance = accountNow.exists ? (accountNow.data().balance ?? 0) : 0;
          const balanceAfter = previousBalance + amount;

          const sequence = await nextSequence(tx, db, `invoice-${year}`);
          const invoiceNumber = formatInvoiceNumber(config.invoicePrefix, year, sequence);
          const invoiceId = `${targetPeriod}_${phone}`;
          const dueAt = computeNextDueDate(config);

          tx.set(entryDoc, {
            type: 'invoice',
            amount,
            magnitude: amount,
            method: null,
            reference: invoiceNumber,
            note: `Fees for ${targetPeriod}`,
            occurredAt: new Date(),
            recordedAt: FieldValue.serverTimestamp(),
            recordedBy: actor,
            balanceAfter,
            reversesEntryId: null,
            sourceReceiptId: null,
            session,
            phone,
          });

          tx.set(
            accountRef(db, phone),
            {
              phone,
              session,
              balance: balanceAfter,
              lastInvoiceId: invoiceId,
              nextDueDate: dueAt,
              status: 'due',
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          tx.set(invoiceRef(db, invoiceId), {
            phone,
            session,
            number: invoiceNumber,
            period: targetPeriod,
            amount,
            amountPaid: 0,
            balance: amount,
            status: 'issued',
            issuedAt: FieldValue.serverTimestamp(),
            dueAt,
            paidAt: null,
            pdfPath: null,
          });

          tx.set(
            studentDoc.ref,
            { feeBalance: balanceAfter, nextDueDate: dueAt },
            { merge: true }
          );

          tx.set(
            db.doc('aggregates/dashboard'),
            {
              totalOutstanding: FieldValue.increment(amount),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          return { duplicate: false, invoiceNumber, balanceAfter };
        });

        if (outcome.duplicate) {
          results.skipped.push({ phone, reason: 'already_invoiced_this_period' });
        } else {
          results.issued.push({ phone, amount, invoiceNumber: outcome.invoiceNumber });
          results.total += amount;
        }
      } catch (err) {
        log?.error('Invoice generation failed for one student', err);
        results.skipped.push({ phone, reason: 'error' });
      }
    }
  }

  return results;
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  tier: 'silver',
  schema,
  rateLimit: { bucket: 'fees_invoice_run', limit: 10, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const results = await runInvoiceGeneration({
      period: body.period,
      sessions: body.sessions,
      dryRun: body.dryRun === true,
      actor: user.uid,
      log,
    });

    log.info('Invoice run complete', {
      period: results.period,
      issued: results.issued.length,
      skipped: results.skipped.length,
      dryRun: body.dryRun === true,
    });

    if (!body.dryRun) {
      await tryWriteAudit(
        {
          action: 'fees.invoices_generated',
          actor: user.uid,
          actorRole: user.role,
          target: `period:${results.period}`,
          after: { issued: results.issued.length, total: results.total },
          context: { requestId: log.requestId },
        },
        log
      );
    }

    return { ok: true, ...results };
  },
});
