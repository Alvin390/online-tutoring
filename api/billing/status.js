import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { resolveSubscriptionState, publicProjection } from '../_lib/subscription.js';
import { isEnabled } from '../_lib/flags.js';

/**
 * Subscription status, with the lazy on-read check — Phase 03 D5.
 *
 * The cron is the belt; this is the braces. If the scheduled sweep is delayed
 * or fails, the state is still recomputed on the next authenticated read, so
 * access terminates on time regardless. Relying on a scheduler alone means a
 * scheduler outage silently extends everyone's access.
 *
 * Writes only when the status actually changed, so a healthy subscription costs
 * one read and no write.
 */

export default createHandler({
  method: 'GET',
  auth: true,
  role: 'teacher',
  handle: async ({ log }) => {
    if (!(await isEnabled('billing.enabled'))) {
      // Flag off = pre-upgrade behaviour, full access, no gating.
      return { billingEnabled: false, subscription: null, accessGranted: true };
    }

    const db = getDb();
    const ref = db.doc('subscription/current');
    const snap = await ref.get();
    const sub = snap.exists ? snap.data() : null;

    const resolved = resolveSubscriptionState(sub, Date.now());

    if (resolved.changed) {
      log.info('On-read state transition', {
        from: sub?.status,
        to: resolved.status,
        reason: resolved.reason,
      });

      const patch = {
        status: resolved.status,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (resolved.graceEndsAt) patch.graceEndsAt = new Date(resolved.graceEndsAt);
      if (resolved.deleteDataAt) patch.dataRetentionDeleteAt = new Date(resolved.deleteDataAt);

      await ref.set(patch, { merge: true });

      const after = { ...sub, ...patch, status: resolved.status };
      await db.doc('subscription/public').set(publicProjection(after) ?? {}, { merge: false });
    }

    const effective = resolved.changed ? { ...sub, status: resolved.status } : sub;

    return {
      billingEnabled: true,
      subscription: publicProjection(effective),
      accessGranted: resolved.accessGranted,
      graceEndsAt: resolved.graceEndsAt,
      reason: resolved.reason,
    };
  },
});
