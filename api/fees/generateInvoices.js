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
import { runResumable } from '../_lib/sweepCursor.js';
import { SubrequestBudgetExceeded } from '../_lib/firestoreRest.js';

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

/**
 * Shared by the handler and the cron.
 *
 * BOUNDED AND RESUMABLE since Phase 12. Cloudflare's free plan allows 50
 * external subrequests per invocation and each student costs roughly four, so
 * an unbounded run would stop dead around the twelfth student with no record of
 * where. Instead each call processes at most `SWEEP_BATCH_SIZE` students,
 * records the last one it finished, and resumes from there — see
 * ../_lib/sweepCursor.js.
 *
 * `complete: false` in the result means there is more to do. The cron picks it
 * up on its next firing; a teacher running it by hand is told to run it again.
 *
 * The cursor is keyed by PERIOD, so a new billing month always starts from the
 * beginning regardless of where the previous month stopped.
 */
export async function runInvoiceGeneration({ period, sessions, dryRun = false, actor, log, budget }) {
  const db = getDb();
  const targetPeriod = period ?? currentPeriod();
  const [year] = targetPeriod.split('-').map(Number);

  const configSnap = await db.doc('fees/config').get();
  const config = { ...DEFAULT_FEE_CONFIG, ...(configSnap.exists ? configSnap.data() : {}) };

  const sessionList = sessions ?? ['morning', 'evening'];
  const results = {
    period: targetPeriod, issued: [], skipped: [], total: 0, complete: true, resumed: false,
  };

  // ---- Build one deterministically ordered list across every session.
  //      The resume works by finding the stored key in this list, so the order
  //      must be stable between invocations — hence the explicit sort rather
  //      than relying on Firestore's default document ordering.
  const candidates = [];
  for (const session of sessionList) {
    // eslint-disable-next-line no-await-in-loop
    const students = await db.collection(`sessions/${session}/students`).get();
    const ordered = [...students.docs].sort((a, b) => a.id.localeCompare(b.id));
    for (const studentDoc of ordered) {
      candidates.push({ session, studentDoc, phone: studentDoc.id });
    }
  }

  // ---- One batched read for every account, rather than one per student.
  const accountSnaps = await db.getAll(candidates.map((c) => accountRef(db, c.phone)));
  const accountsByPhone = new Map(
    candidates.map((c, i) => [c.phone, accountSnaps[i].exists ? accountSnaps[i].data() : null])
  );

  const perStudent = async ({ session, studentDoc, phone }) => {
    const student = studentDoc.data();

    // Only approved, unblocked-by-approval students are billed. Invoicing
    // someone the teacher has not yet accepted would be nonsense.
    if ((student.approvalStatus ?? 'approved') !== 'approved') {
      results.skipped.push({ phone, reason: 'not_approved' });
      return;
    }

    const account = accountsByPhone.get(phone) ?? null;

    const amount = resolveFeeAmount({ student, account, config });

    // null means no fee configured for this class. Reported rather than
    // silently invoiced at zero — a KES 0 invoice looks deliberate and hides
    // a setup mistake.
    if (amount === null) {
      results.skipped.push({ phone, reason: 'no_fee_configured', class: student.class ?? null });
      return;
    }

    if (amount === 0) {
      results.skipped.push({ phone, reason: 'zero_fee' });
      return;
    }

    if (dryRun) {
      results.issued.push({ phone, amount, invoiceNumber: '(dry run)' });
      results.total += amount;
      return;
    }

    // Idempotency: same phone + same period = same entry ID.
    const entryId = `invoice_${targetPeriod}`;
    const entryDoc = ledgerRef(db, phone).doc(entryId);

    try {
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
      if (err instanceof SubrequestBudgetExceeded) throw err;
      log?.error('Invoice generation failed for one student', err);
      results.skipped.push({ phone, reason: 'error' });
    }
  };

  const outcome = await runResumable({
    name: `invoices_${targetPeriod}`,
    items: candidates,
    // Session and phone together, because the same phone can appear in two
    // sessions and the key has to identify one row of the list uniquely.
    keyOf: (c) => `${c.session}/${c.phone}`,
    handle: perStudent,
    budget,
    log,
  });

  results.complete = outcome.complete;
  results.resumed = outcome.resumed;
  results.processed = outcome.processed;
  results.remaining = candidates.length - outcome.processed;

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

    log.info(results.complete ? 'Invoice run complete' : 'Invoice run partial — resume pending', {
      period: results.period,
      issued: results.issued.length,
      skipped: results.skipped.length,
      remaining: results.remaining,
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
