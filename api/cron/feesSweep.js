import { randomUUID } from 'node:crypto';
import { createLogger } from '../_lib/log.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { safeCompare } from '../_lib/crypto.js';
import { isEnabled } from '../_lib/flags.js';
import { accountRef } from '../_lib/ledger.js';
import { DEFAULT_FEE_CONFIG } from '../fees/config.js';
import { runInvoiceGeneration } from '../fees/generateInvoices.js';
import { tryWriteAudit } from '../_lib/audit.js';

/**
 * Nightly fee sweep — Phase 06 D8.
 *
 * Two jobs:
 *   1. Flag students past their due date as overdue.
 *   2. On the billing day, run invoice generation.
 *
 * DEFAULT BEHAVIOUR IS FLAG, NOT BLOCK (Q52). The teacher gets an "Overdue (N)"
 * panel with a bulk-block action that names every student and amount before
 * confirming. Automatically locking children out of a class over a date
 * calculation, with nobody having looked at it, is not something to inherit by
 * default.
 *
 * `autoBlockOnOverdue` is opt-in per teacher, and turning it on shows a warning
 * that students will be locked out without review.
 */

export const config = { maxDuration: 60 };

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
    log.warn('Unauthorized fee sweep invocation');
    return res.status(401).json({ error: { code: 'unauthorized' } });
  }

  if (!(await isEnabled('fees.enabled'))) {
    return res.status(200).json({ ok: true, skipped: 'fees_disabled' });
  }

  const db = getDb();
  const now = new Date();
  const result = { overdueFlagged: 0, autoBlocked: 0, invoiceRun: null };

  try {
    const configSnap = await db.doc('fees/config').get();
    const feeConfig = { ...DEFAULT_FEE_CONFIG, ...(configSnap.exists ? configSnap.data() : {}) };

    // ---- 1. Invoice run, on the billing day only.
    if (now.getUTCDate() === Math.min(feeConfig.billingDayOfMonth ?? 1, 28)) {
      result.invoiceRun = await runInvoiceGeneration({ actor: 'system:cron', log });
      log.info('Scheduled invoice run complete', {
        issued: result.invoiceRun.issued.length,
        skipped: result.invoiceRun.skipped.length,
      });
    }

    // ---- 2. Overdue sweep.
    const accounts = await db.collection('fees/accounts/items').get();
    const overdue = [];

    for (const accountDoc of accounts.docs) {
      const account = accountDoc.data();
      const dueAt = account.nextDueDate?.toMillis?.() ?? null;

      if (dueAt === null) continue;
      if ((account.balance ?? 0) <= 0) continue;
      if (dueAt > now.getTime()) continue;

      overdue.push({ phone: accountDoc.id, session: account.session, balance: account.balance });
    }

    if (overdue.length > 0) {
      const batch = db.batch();

      for (const item of overdue) {
        batch.set(
          accountRef(db, item.phone),
          { status: 'overdue', updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );

        if (item.session) {
          batch.set(
            db.doc(`sessions/${item.session}/students/${item.phone}`),
            {
              overdue: true,
              // Opt-in only. The derived block reason from D5 then appears with
              // no teacher involvement, reading the live balance.
              ...(feeConfig.autoBlockOnOverdue === true
                ? { blocked: true, blockedAt: FieldValue.serverTimestamp() }
                : {}),
            },
            { merge: true }
          );
        }
      }

      batch.set(
        db.doc('aggregates/dashboard'),
        { overdueCount: overdue.length, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );

      await batch.commit();

      result.overdueFlagged = overdue.length;
      result.autoBlocked = feeConfig.autoBlockOnOverdue === true ? overdue.length : 0;

      log.info('Overdue sweep complete', {
        flagged: result.overdueFlagged,
        autoBlocked: result.autoBlocked,
      });

      if (result.autoBlocked > 0) {
        await tryWriteAudit(
          {
            action: 'fees.auto_blocked',
            actor: 'system:cron',
            target: 'overdue_sweep',
            after: { count: result.autoBlocked },
            context: { requestId },
          },
          log
        );
      }
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    log.error('Fee sweep failed', err);
    return res.status(500).json({ error: { code: 'sweep_failed' } });
  }
}
