import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { resolveSubscriptionState, publicProjection } from '../_lib/subscription.js';
import { isEnabled } from '../_lib/flags.js';
import { invalidatePlanCache, schoolPlan } from '../_lib/schoolPlan.js';
import { TRIAL_SMS_UNITS, PLAN_IDS, mergePlans } from '../_lib/plans.js';
import { creditContext, peekCredits } from '../_lib/smsCredits.js';

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
  handle: async ({ log, user }) => {
    if (!(await isEnabled('billing.enabled'))) {
      // Flag off = pre-upgrade behaviour, full access, no billing gate. The
      // plan's features still apply (013Fixes / 00), so they are returned.
      return { billingEnabled: false, subscription: null, accessGranted: true, plan: await planView(user) };
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
      invalidatePlanCache();

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
      plan: await planView(user),
    };
  },
});

/**
 * The school's plan for the screens — 013Fixes / 00. The SAME `schoolPlan()`
 * the server gates use, superadmin overrides included, so a screen can never
 * offer what the server refuses (or hide what it allows). The client keeps its
 * own copy of the shipped plans only as a stand-in until this arrives.
 */
async function planView(user) {
  const [plan, usageSnap] = await Promise.all([
    schoolPlan(),
    // 013Fixes / 12: the stored usage count (phase 11), shown on the billing
    // page and as a notice at 100%. One document, no counting here.
    getDb().doc('config/usage').get().catch(() => null),
  ]);
  // 013Fixes / 07: every plan's limits and card words (superadmin settings
  // included), so the billing page's three cards match what each plan holds.
  const all = mergePlans(plan.overrides);
  const catalog = Object.fromEntries(PLAN_IDS.map((id) => [id, { limits: all[id].limits, card: all[id].card }]));
  return {
    tier: plan.tier, comp: plan.comp, features: plan.features, limits: plan.limits, trialSmsUnits: TRIAL_SMS_UNITS, catalog,
    // 013Fixes / 10: whether this login is the school owner (the logins screen).
    isOwner: Boolean(user?.uid) && user.uid === plan.ownerUid,
    usage: usageView(usageSnap),
    // 013Fixes / 16: SMS units (included this window, used, extra) — read only.
    smsUnits: plan.features.bulkSms
      ? await creditContext(getDb()).then((ctx) => peekCredits(getDb(), ctx)).catch(() => null)
      : null,
  };
}

/** The stored usage for the screens: counts, limits, percentages and the window. */
function usageView(snap) {
  if (!snap?.exists) return null;
  const u = snap.data();
  const iso = (v) => v?.toDate?.()?.toISOString?.() ?? null;
  return {
    activeStudents: u.activeStudents ?? 0,
    sessions: u.sessions ?? 0,
    logins: u.logins ?? 0,
    limits: u.limits ?? {},
    percent: u.percent ?? {},
    windowStart: iso(u.windowStart),
    windowEnd: iso(u.windowEnd),
    windowKind: u.windowKind ?? null,
    countedAt: u.countedAtMs ? new Date(u.countedAtMs).toISOString() : null,
  };
}
