import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, tierSchema } from '../_lib/validate.js';
import { badRequest, notFound } from '../_lib/errors.js';
import { disableSubscription, TIER_PRICE_KES } from '../_lib/paystack.js';
import { STATUS, publicProjection, toMillis } from '../_lib/subscription.js';
import { setUserClaims } from '../_lib/claims.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';
import { TIER_RANK } from '../_lib/auth.js';

/**
 * Cancel, downgrade, and superadmin grant — Phase 03 D8.
 *
 * Upgrades are NOT here: an upgrade takes payment immediately (Q7), so it goes
 * through /api/billing/initialize like any other purchase. Routing a
 * money-taking action through an endpoint called "manage" would make it too
 * easy to forget it charges.
 *
 * Downgrades take effect at currentPeriodEnd (Q6) via `scheduledTierChange`.
 * Data from the lost tier is retained and hidden, never deleted — nothing is
 * destroyed at a tier boundary, ever.
 */

const schema = z
  .object({
    action: z.enum(['cancel', 'resume', 'schedule_downgrade', 'grant']),
    tier: tierSchema.optional(),
  })
  .strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'billing_manage', limit: 20, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const { action, tier } = body;
    const db = getDb();
    const ref = db.doc('subscription/current');

    const snap = await ref.get();
    const sub = snap.exists ? snap.data() : null;

    // 'grant' is superadmin-only and is the one action that needs no
    // subscription to already exist.
    if (action === 'grant') {
      if (user.role !== 'superadmin') {
        throw badRequest('Only a superadmin can grant a tier without payment.', 'forbidden');
      }
      if (!tier) throw badRequest('A tier is required to grant.');

      const now = Date.now();
      const patch = {
        tier,
        status: STATUS.ACTIVE,
        renewalMode: 'manual',
        grantedBySuperadmin: true,
        currentPeriodStart: new Date(now),
        // Deliberately far out. The cron skips grantedBySuperadmin records
        // entirely, so this date is documentation rather than an expiry.
        currentPeriodEnd: new Date(now + 365 * 24 * 60 * 60 * 1000),
        graceEndsAt: null,
        cancelAtPeriodEnd: false,
        updatedAt: FieldValue.serverTimestamp(),
      };

      await ref.set(patch, { merge: true });
      await db.doc('subscription/public').set(publicProjection({ ...sub, ...patch }), { merge: false });

      await tryWriteAudit(
        {
          action: AuditAction.TIER_GRANTED_BY_SUPERADMIN,
          actor: user.uid,
          actorRole: user.role,
          target: 'subscription/current',
          before: sub ? { tier: sub.tier, status: sub.status } : null,
          after: { tier, status: STATUS.ACTIVE, grantedBySuperadmin: true },
          context: { requestId: log.requestId },
        },
        log
      );

      log.info('Tier granted by superadmin', { tier });
      return { ok: true, tier, status: STATUS.ACTIVE, grantedBySuperadmin: true };
    }

    if (!sub) throw notFound('There is no subscription to manage yet.');

    const before = { status: sub.status, tier: sub.tier, cancelAtPeriodEnd: sub.cancelAtPeriodEnd };

    switch (action) {
      case 'cancel': {
        // Reversible until the period actually ends. The UI states the exact
        // date access stops, so nobody cancels expecting an immediate refund.
        if (sub.paystackSubscriptionCode && sub.paystackEmailToken) {
          try {
            await disableSubscription({
              code: sub.paystackSubscriptionCode,
              token: sub.paystackEmailToken,
            });
          } catch (err) {
            // Local cancellation still stands; the cron reconciles. Better to
            // honour the teacher's intent than to fail on a provider hiccup.
            log.error('Paystack disable failed; cancelling locally', err);
          }
        }

        const patch = {
          cancelAtPeriodEnd: true,
          status: STATUS.CANCELLED,
          updatedAt: FieldValue.serverTimestamp(),
        };
        await ref.set(patch, { merge: true });
        await db.doc('subscription/public').set(publicProjection({ ...sub, ...patch }), { merge: false });

        await tryWriteAudit(
          {
            action: AuditAction.SUBSCRIPTION_CANCELLED,
            actor: user.uid,
            actorRole: user.role,
            target: 'subscription/current',
            before,
            after: patch,
            context: { requestId: log.requestId },
          },
          log
        );

        return {
          ok: true,
          status: STATUS.CANCELLED,
          accessUntil: toMillis(sub.currentPeriodEnd),
        };
      }

      case 'resume': {
        if (sub.cancelAtPeriodEnd !== true) {
          throw badRequest('This subscription is not scheduled to cancel.');
        }
        const patch = {
          cancelAtPeriodEnd: false,
          status: STATUS.ACTIVE,
          updatedAt: FieldValue.serverTimestamp(),
        };
        await ref.set(patch, { merge: true });
        await db.doc('subscription/public').set(publicProjection({ ...sub, ...patch }), { merge: false });

        await tryWriteAudit(
          {
            action: AuditAction.SUBSCRIPTION_CHANGED,
            actor: user.uid,
            actorRole: user.role,
            before,
            after: patch,
            context: { requestId: log.requestId, change: 'resume' },
          },
          log
        );

        return { ok: true, status: STATUS.ACTIVE };
      }

      case 'schedule_downgrade': {
        if (!tier) throw badRequest('A target tier is required.');

        const currentRank = TIER_RANK[sub.tier] ?? 0;
        const targetRank = TIER_RANK[tier] ?? 0;

        if (targetRank >= currentRank) {
          throw badRequest(
            'That is not a downgrade. Upgrades take effect immediately and are paid for at checkout.',
            'not_a_downgrade'
          );
        }

        const patch = {
          scheduledTierChange: { tier, effectiveAt: sub.currentPeriodEnd ?? null },
          updatedAt: FieldValue.serverTimestamp(),
        };
        await ref.set(patch, { merge: true });
        await db.doc('subscription/public').set(publicProjection({ ...sub, ...patch }), { merge: false });

        await tryWriteAudit(
          {
            action: AuditAction.SUBSCRIPTION_CHANGED,
            actor: user.uid,
            actorRole: user.role,
            before,
            after: patch,
            context: { requestId: log.requestId, change: 'downgrade_scheduled' },
          },
          log
        );

        return {
          ok: true,
          scheduledTier: tier,
          effectiveAt: toMillis(sub.currentPeriodEnd),
          // Reassurance that matters: a downgrade must never read as data loss.
          note: 'Your data from the higher tier is kept and hidden, and comes back if you upgrade again.',
          newPriceKes: TIER_PRICE_KES[tier],
        };
      }

      default:
        throw badRequest('Unknown action.');
    }
  },
});
