import { getDb } from './firebaseAdmin.js';
import { ApiError, forbidden } from './errors.js';
import { PLAN_IDS, mergePlans, planFor, lowestPlanWith } from './plans.js';
import { applySchoolOverrides } from './schoolOverrides.js';

/**
 * The school's plan — 013Fixes / 00.
 *
 * Until now every gate read the signed-in login's own `tier` claim. One school
 * has one subscription, though, and with several dashboard logins the claims
 * drift: new logins were created as Bronze, and the hourly sweep only repairs
 * the owner's. The plan now comes from `subscription/current`, the same
 * document the money paths already treat as the authority, for every login.
 *
 * FEATURES COME FROM THE TIER ALONE. Billing status (trial, grace, locked,
 * expired) never changes what a plan includes: a lapsed Silver school keeps
 * Silver's features and its data, and locking stays enforced where it always
 * was (the client billing gate; class/link, calendar/events and
 * mpesaAvailability for students). Mixing the two would, for example, have
 * the scheduled-block sweep cancel a school's schedules the moment a payment
 * ran late.
 *
 * Cost: `subscription/current` and `config/plans` are read together at most
 * once a minute per isolate. Writers of either document call
 * `invalidatePlanCache()` so the isolate that made the change sees it at once;
 * other isolates catch up within the minute (claims could be an hour stale).
 *
 * Failure: a missing subscription document means "no plan" (every gated
 * feature refused). A failed READ is not "no plan": it throws 503 and caches
 * nothing, so a Firestore hiccup can never quietly downgrade a paying school.
 */

const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

/** Forget the cached plan (after any write to the subscription or config/plans). */
export function invalidatePlanCache() {
  cache = null;
  cachedAt = 0;
}

/** Test hook, same name pattern as the flag and session caches. */
export const __resetPlanCache = invalidatePlanCache;

/**
 * The plan for a subscription document and a `config/plans` override. Pure,
 * so the money paths that already hold a fresh subscription read can use it
 * without a second (cached) read.
 */
export function resolvePlan(sub, overrides) {
  const tier = PLAN_IDS.includes(sub?.tier) ? sub.tier : null;
  // 013Fixes / 22: the school's own overrides on top, last (`custom` when any).
  const { features, limits, custom } = applySchoolOverrides(planFor(tier, mergePlans(overrides)), sub?.schoolOverrides);
  return {
    tier,
    status: sub?.status ?? null,
    comp: sub?.grantedBySuperadmin === true,
    // 013Fixes / 10: the school owner's login (manages the school's logins).
    ownerUid: typeof sub?.ownerUid === 'string' ? sub.ownerUid : null,
    features,
    limits,
    custom,
  };
}

/**
 * @returns {Promise<{tier: string|null, status: string|null, comp: boolean,
 *   features: Record<string, boolean>, limits: Record<string, number>, overrides: object|null}>}
 */
export async function schoolPlan(db = getDb()) {
  const now = Date.now();
  if (cache && now - cachedAt < TTL_MS) return cache;

  let subSnap;
  let plansSnap;
  try {
    [subSnap, plansSnap] = await Promise.all([
      db.doc('subscription/current').get(),
      db.doc('config/plans').get(),
    ]);
  } catch (cause) {
    throw new ApiError(503, 'plan_unavailable', 'Could not check your plan just now. Please try again.', { cause });
  }

  return rememberPlan(subSnap, plansSnap, now);
}

/**
 * 013Fixes / 05: for a hot path that already makes one batched read (student
 * check-in): the fresh cached plan, or null — with no read.
 */
export function cachedPlan(now = Date.now()) {
  return cache && now - cachedAt < TTL_MS ? cache : null;
}

/** The two documents the plan is made of, for a caller's own batchGet. */
export function planRefs(db) {
  return [db.doc('subscription/current'), db.doc('config/plans')];
}

/** The plan from snapshots of `planRefs` the caller read itself; cached like schoolPlan's. */
export function rememberPlan(subSnap, plansSnap, now = Date.now()) {
  const overrides = plansSnap?.exists ? plansSnap.data() : null;
  const plan = { ...resolvePlan(subSnap?.exists ? subSnap.data() : null, overrides), overrides };
  cache = plan;
  cachedAt = now;
  return plan;
}

/** True when the signed-in user may use `feature`. The superadmin may use anything. */
export async function hasFeature(user, feature, db = getDb()) {
  if (user?.role === 'superadmin') return true;
  const plan = await schoolPlan(db);
  return plan.features[feature] === true;
}

/**
 * Server gate. Refuses with 403 `tier_required` (the code the client already
 * understands) and names the cheapest plan that includes the feature.
 */
export async function requireFeature(user, feature, db = getDb()) {
  if (user?.role === 'superadmin') return user;
  const plan = await schoolPlan(db);
  if (plan.features[feature] === true) return user;
  const needs = lowestPlanWith(feature, plan.overrides ? mergePlans(plan.overrides) : undefined);
  throw forbidden(
    needs ? `This feature requires the ${needs} plan.` : 'This feature is not included in your plan.',
    'tier_required'
  );
}
