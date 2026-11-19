/**
 * What each plan includes — 013Fixes / 00.
 *
 * PARITY PAIR with src/shared/constants/plans.js (tests/unit/fixes013/plans.test.js
 * keeps the two identical). Change both sides together.
 *
 * One map answers "may this school use X?" for the server gates
 * (`requireFeature`), the screen gates (`TierGate`, `usePlan`) and, later, the
 * capacity and SMS allowances. A plan is a set of named features plus included
 * limits, never a rank comparison scattered through the code: changing one
 * plan must not quietly change an unrelated feature.
 *
 * Every feature is spelled out as true or false for every plan. A key missing
 * from a plan is a bug, not a default.
 *
 * The superadmin can override features and limits per plan in `config/plans`
 * (013Fixes / 07); `mergePlans` applies an override on top of these defaults,
 * ignoring anything malformed.
 */

export const PLAN_IDS = ['bronze', 'silver', 'gold'];

/** Every feature a plan can include, in display order. */
export const FEATURE_KEYS = [
  'sessions',
  'calendar',
  'notes',
  'basicBlocks',
  'scheduledBlocks',
  'fees',
  'feePayments',
  'feeBlocks',
  'invoices',
  'bulkSms',
  'targetedSms',
  'whatsappOneToOne',
  'whatsappCampaigns',
  'whatsappAdvanced',
  'mpesaStk',
];

/** Every included limit a plan carries (whole numbers, 0 or more). */
export const LIMIT_KEYS = ['activeStudents', 'sessions', 'logins', 'smsUnits'];

/** Free SMS units for a school on its trial, whatever the plan (owner, 2026-11-19). */
export const TRIAL_SMS_UNITS = 100;

const ALL = (value) => ({ bronze: value, silver: value, gold: value });
const SILVER_UP = { bronze: false, silver: true, gold: true };
const GOLD_ONLY = { bronze: false, silver: false, gold: true };

/**
 * Feature → which plans include it. Phase 00 copied the gates as they were on
 * 2026-11-19; phases 02–06 move them to the owner's matrix (spec §2):
 *   02  calendar and one-to-one WhatsApp on every plan.
 */
const FEATURE_PLANS = {
  sessions: ALL(true),
  calendar: ALL(true), // 013Fixes / 02: every plan (owner)
  notes: ALL(true),
  basicBlocks: ALL(true),
  scheduledBlocks: ALL(true),
  fees: SILVER_UP,
  feePayments: SILVER_UP,
  feeBlocks: SILVER_UP,
  invoices: SILVER_UP,
  bulkSms: SILVER_UP,
  targetedSms: GOLD_ONLY,
  whatsappOneToOne: ALL(true), // 013Fixes / 02: every plan (owner)
  whatsappCampaigns: SILVER_UP,
  whatsappAdvanced: GOLD_ONLY,
  mpesaStk: GOLD_ONLY,
};

const PLAN_LIMITS = {
  bronze: { activeStudents: 100, sessions: 2, logins: 2, smsUnits: 0 },
  silver: { activeStudents: 300, sessions: 5, logins: 5, smsUnits: 1000 },
  gold: { activeStudents: 500, sessions: 10, logins: 10, smsUnits: 3000 },
};

function buildDefaults() {
  const plans = {};
  for (const id of PLAN_IDS) {
    const features = {};
    for (const key of FEATURE_KEYS) features[key] = FEATURE_PLANS[key][id];
    plans[id] = { features, limits: { ...PLAN_LIMITS[id] } };
  }
  return plans;
}

/** The plans as shipped in code. Frozen so no caller can edit them in place. */
export const DEFAULT_PLANS = deepFreeze(buildDefaults());

/** No subscription, or an unknown tier: nothing gated is included. */
export const NO_PLAN = deepFreeze({
  features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, false])),
  limits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, 0])),
});

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const isWholeNumber = (v) => Number.isInteger(v) && v >= 0 && v <= 1_000_000;

/**
 * The defaults with a `config/plans` override applied on top. Only known plan
 * ids, known feature keys with boolean values and known limit keys with whole
 * numbers are taken; everything else is ignored, so a malformed document can
 * never switch a gate open or set a limit to nonsense.
 * @param {object|null|undefined} overrides  { bronze?: { features?, limits? }, ... }
 */
export function mergePlans(overrides) {
  const plans = {};
  for (const id of PLAN_IDS) {
    const base = DEFAULT_PLANS[id];
    const over = overrides && typeof overrides === 'object' ? overrides[id] : null;
    const features = { ...base.features };
    const limits = { ...base.limits };
    if (over && typeof over === 'object') {
      for (const key of FEATURE_KEYS) {
        if (typeof over.features?.[key] === 'boolean') features[key] = over.features[key];
      }
      for (const key of LIMIT_KEYS) {
        if (isWholeNumber(over.limits?.[key])) limits[key] = over.limits[key];
      }
    }
    plans[id] = { features, limits };
  }
  return plans;
}

/**
 * The features and limits for one tier (with overrides already merged in by
 * `mergePlans`). An unknown or missing tier gets NO_PLAN.
 */
export function planFor(tier, plans = DEFAULT_PLANS) {
  return PLAN_IDS.includes(tier) && plans?.[tier] ? plans[tier] : NO_PLAN;
}

/** The cheapest plan that includes `feature`, for "This needs the X plan" wording. */
export function lowestPlanWith(feature, plans = DEFAULT_PLANS) {
  return PLAN_IDS.find((id) => plans?.[id]?.features?.[feature] === true) ?? null;
}
