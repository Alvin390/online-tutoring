import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { badRequest } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { invalidatePlanCache } from '../_lib/schoolPlan.js';
import {
  PLAN_IDS, FEATURE_KEYS, LIMIT_KEYS, CARD_LIMITS, DEFAULT_PLANS, mergePlans,
} from '../_lib/plans.js';

/**
 * Plan settings — 013Fixes / 07. Superadmin only.
 *
 * Changing what a plan includes (features), its included limits, or its
 * card's words is a setting here, not new code. The document is
 * `config/plans` (server-only); every gate reads it through `schoolPlan()`
 * on top of the shipped defaults, so a change applies everywhere: this
 * isolate at once, others within a minute.
 *
 * Prices are NOT here: they live with the Paystack plans (pricing series).
 *
 *   get    → the shipped defaults, the saved overrides and the result
 *   save   → replaces the overrides for the plans sent (validated, audited)
 *   reset  → removes one plan's overrides (back to the shipped defaults)
 *
 * A save must keep the ladder: a feature a lower plan has, every higher plan
 * has too. A save that breaks it is refused, so "Bronze has fees but Silver
 * doesn't" can never be stored.
 */

const planOverride = z
  .object({
    features: z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean().optional()]))).strict().optional(),
    limits: z.object(Object.fromEntries(LIMIT_KEYS.map((k) => [k, z.number().int().min(0).max(1_000_000).optional()]))).strict().optional(),
    card: z
      .object({
        tagline: z.string().trim().min(1).max(CARD_LIMITS.tagline).optional(),
        description: z.string().trim().min(1).max(CARD_LIMITS.description).optional(),
        bullets: z.array(z.string().trim().min(1).max(CARD_LIMITS.bullet)).min(1).max(CARD_LIMITS.bullets).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get') }).strict(),
  z.object({
    action: z.literal('save'),
    plans: z.object(Object.fromEntries(PLAN_IDS.map((id) => [id, planOverride.optional()]))).strict(),
  }).strict(),
  z.object({ action: z.literal('reset'), plan: z.enum(PLAN_IDS) }).strict(),
]);

/** The features no lower plan may have without every higher plan having it. */
export function ladderProblems(plans) {
  const problems = [];
  for (const key of FEATURE_KEYS) {
    for (let i = 0; i < PLAN_IDS.length - 1; i += 1) {
      const lower = PLAN_IDS[i];
      for (const higher of PLAN_IDS.slice(i + 1)) {
        if (plans[lower].features[key] === true && plans[higher].features[key] !== true) {
          problems.push(`${key}: ${lower} has it but ${higher} doesn't`);
        }
      }
    }
  }
  return problems;
}

/** Drop empty parts, so the stored document holds only real overrides. */
function compact(override) {
  const out = {};
  for (const part of ['features', 'limits', 'card']) {
    const value = override?.[part];
    if (value && Object.keys(value).length) out[part] = value;
  }
  return out;
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  rateLimit: { bucket: 'admin_plans', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const db = getDb();
    const ref = db.doc('config/plans');
    const snap = await ref.get();
    const before = snap.exists ? snap.data() : {};

    if (body.action === 'get') {
      return { defaults: DEFAULT_PLANS, overrides: before, effective: mergePlans(before) };
    }

    let next;
    if (body.action === 'reset') {
      next = { ...before };
      delete next[body.plan];
    } else {
      next = { ...before };
      for (const [id, override] of Object.entries(body.plans)) {
        if (override === undefined) continue;
        const kept = compact(override);
        if (Object.keys(kept).length) next[id] = kept;
        else delete next[id];
      }
    }

    // Only what mergePlans would actually take is stored; then the ladder.
    const effective = mergePlans(next);
    const problems = ladderProblems(effective);
    if (problems.length) {
      throw badRequest(`Each plan must include everything a cheaper plan has. ${problems.join('; ')}.`, 'plan_ladder');
    }

    await ref.set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid });
    invalidatePlanCache();
    log.info('Plan settings saved', { action: body.action, plans: Object.keys(next).filter((k) => PLAN_IDS.includes(k)) });

    await tryWriteAudit({
      action: 'billing.plans_changed',
      actor: user.uid,
      actorRole: user.role,
      target: 'config/plans',
      before: pick(before),
      after: pick(next),
      context: { requestId: log.requestId, via: 'superadmin_console', change: body.action },
    }, log);

    return { ok: true, overrides: pick(next), effective };
  },
});

function pick(doc) {
  return Object.fromEntries(PLAN_IDS.filter((id) => doc?.[id]).map((id) => [id, doc[id]]));
}
