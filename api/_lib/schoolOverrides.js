import { FEATURE_KEYS, LIMIT_KEYS } from './plans.js';

/**
 * Per-school overrides — 013Fixes / 22 (owner suggestion 8). On top of the
 * school's plan (and the superadmin's plan settings, config/plans), a custom
 * limit or a feature switched on or off for THIS school:
 *
 *   subscription/current.schoolOverrides = { limits: { logins: 7 }, features: { fees: false } }
 *
 * Named `schoolOverrides`, never `overrides`: the plan object already uses
 * `overrides` for config/plans (mergePlans, the upgrade cards' wording).
 * Applied last, by resolvePlan (every gate, limit and screen) and by the SMS
 * units window. Written whole (update, not a merge-set) so a key taken out is
 * really gone.
 *
 * No validate.js import here: it closes an import loop (validate.js →
 * sessions.js → publicBootstrap.js → mpesaAvailability.js → schoolPlan.js →
 * this module), and whichever loads first sees the other half-initialised —
 * a schema's SLUG_PATTERN came out undefined. The request schema lives with
 * the endpoint (api/admin/billing.js).
 */

/** Only well-formed, known keys (stored data is never trusted blindly). */
export function cleanSchoolOverrides(raw) {
  const limits = {};
  const features = {};
  if (raw && typeof raw === 'object') {
    for (const key of LIMIT_KEYS) {
      const v = raw.limits?.[key];
      if (Number.isInteger(v) && v >= 0 && v <= 1_000_000) limits[key] = v;
    }
    for (const key of FEATURE_KEYS) {
      if (typeof raw.features?.[key] === 'boolean') features[key] = raw.features[key];
    }
  }
  return { limits, features };
}

export const hasSchoolOverrides = (clean) => Object.keys(clean.limits).length + Object.keys(clean.features).length > 0;

/** The plan's { features, limits } with the school's overrides on top. */
export function applySchoolOverrides({ features, limits }, raw) {
  const clean = cleanSchoolOverrides(raw);
  return {
    features: { ...features, ...clean.features },
    limits: { ...limits, ...clean.limits },
    custom: hasSchoolOverrides(clean),
  };
}
