import { randomUUID } from 'node:crypto';
import { createLogger } from '../_lib/log.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { safeCompare } from '../_lib/crypto.js';
import {
  resolveSubscriptionState,
  publicProjection,
  dueReminders,
  isDueForDeletion,
} from '../_lib/subscription.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';
import { isEnabled } from '../_lib/flags.js';

/**
 * Hourly subscription sweep — Phase 03 D5.
 *
 * Runs from Vercel Cron. Three jobs:
 *   1. Recompute status via the shared pure function and persist any change.
 *   2. Fire the manual-renewal reminder ladder.
 *   3. Purge data 90 days after expiry (Q10).
 *
 * Not createHandler: cron requests carry no user token. Authorization is a
 * shared secret compared in constant time, accepted from either Vercel's own
 * `Authorization: Bearer` header or an explicit `x-cron-secret`.
 *
 * Uses the SAME resolveSubscriptionState as the webhook and the on-read check,
 * which is the point — three callers, one definition of the truth.
 */

export const config = { maxDuration: 60 };

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  // No secret configured means the endpoint is closed, not open. An
  // unauthenticated job that can purge data is not a thing we ship.
  if (!secret) return false;

  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const explicit = req.headers['x-cron-secret'];

  return (
    (bearer != null && safeCompare(bearer, secret)) ||
    (typeof explicit === 'string' && safeCompare(explicit, secret))
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
    log.warn('Unauthorized cron invocation');
    return res.status(401).json({ error: { code: 'unauthorized' } });
  }

  if (!(await isEnabled('billing.enabled'))) {
    return res.status(200).json({ ok: true, skipped: 'billing_disabled' });
  }

  const db = getDb();
  const now = Date.now();
  const result = { transitioned: false, reminders: [], purged: false };

  try {
    const ref = db.doc('subscription/current');
    const snap = await ref.get();
    const sub = snap.exists ? snap.data() : null;

    if (!sub) {
      return res.status(200).json({ ok: true, skipped: 'no_subscription' });
    }

    // Q12: a comped tier is never swept. resolveSubscriptionState already
    // short-circuits on it; checking here too keeps reminders and purge off it.
    if (sub.grantedBySuperadmin === true) {
      return res.status(200).json({ ok: true, skipped: 'granted_by_superadmin' });
    }

    // --- 1. State
    const resolved = resolveSubscriptionState(sub, now);

    if (resolved.changed) {
      const patch = { status: resolved.status, updatedAt: FieldValue.serverTimestamp() };
      if (resolved.graceEndsAt) patch.graceEndsAt = new Date(resolved.graceEndsAt);
      if (resolved.deleteDataAt) patch.dataRetentionDeleteAt = new Date(resolved.deleteDataAt);

      await ref.set(patch, { merge: true });
      await db
        .doc('subscription/public')
        .set(publicProjection({ ...sub, ...patch }) ?? {}, { merge: false });

      result.transitioned = { from: sub.status, to: resolved.status, reason: resolved.reason };
      log.info('Subscription transitioned', result.transitioned);

      await tryWriteAudit(
        {
          action: AuditAction.SUBSCRIPTION_STATE_CHANGED,
          actor: 'system:cron',
          target: 'subscription/current',
          before: { status: sub.status },
          after: { status: resolved.status },
          context: { reason: resolved.reason, requestId },
        },
        log
      );
    }

    // --- 2. Reminders (manual renewal only — see dueReminders)
    const effective = resolved.changed ? { ...sub, status: resolved.status } : sub;
    const due = dueReminders(effective, now);

    if (due.length > 0) {
      // Queued rather than sent inline. Never call an external service from a
      // path that has to finish quickly, and never let a mail failure roll back
      // a state transition that already happened.
      const batch = db.batch();
      for (const id of due) {
        batch.set(db.collection('billing').doc('reminders').collection('queue').doc(`${id}_${sub.currentPeriodEnd?.toMillis?.() ?? now}`), {
          reminderId: id,
          tier: sub.tier,
          renewalMode: sub.renewalMode,
          periodEnd: sub.currentPeriodEnd ?? null,
          status: 'queued',
          queuedAt: FieldValue.serverTimestamp(),
        });
      }
      batch.set(ref, { remindersSent: FieldValue.arrayUnion(...due) }, { merge: true });
      await batch.commit();

      result.reminders = due;
      log.info('Renewal reminders queued', { count: due.length, ids: due });
    }

    // --- 3. Retention purge (Q10)
    if (isDueForDeletion(effective, now)) {
      log.warn('Subscription past its 90-day retention window');
      result.purged = 'pending_manual_confirmation';

      await tryWriteAudit(
        {
          action: AuditAction.DATA_PURGED,
          actor: 'system:cron',
          target: 'subscription/current',
          context: {
            requestId,
            note: 'Retention window elapsed. Purge requires explicit confirmation — see phase-03 notes.',
          },
        },
        log
      );
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    log.error('Subscription sweep failed', err);
    // 500 so the platform surfaces a failing cron rather than reporting green.
    return res.status(500).json({ error: { code: 'sweep_failed' } });
  }
}
