/**
 * What each plan includes — 013Fixes / 00.
 *
 * PARITY PAIR with api/_lib/plans.js (tests/unit/fixes013/plans.test.js keeps the
 * two identical). Change both sides together.
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
 *   03  scheduled blocks Silver and up (was every plan).
 *   06  WhatsApp campaigns on no plan (retired; whatsappAdvanced removed).
 */
const FEATURE_PLANS = {
  sessions: ALL(true),
  calendar: ALL(true), // 013Fixes / 02: every plan (owner)
  notes: ALL(true),
  basicBlocks: ALL(true),
  scheduledBlocks: SILVER_UP, // 013Fixes / 03: Silver and up (owner; was every plan)
  fees: SILVER_UP,
  feePayments: SILVER_UP,
  feeBlocks: SILVER_UP,
  invoices: SILVER_UP,
  bulkSms: SILVER_UP,
  targetedSms: GOLD_ONLY,
  whatsappOneToOne: ALL(true), // 013Fixes / 02: every plan (owner)
  // 013Fixes / 06: retired — on no plan (owner). WhatsApp is one person at a time.
  whatsappCampaigns: ALL(false),
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
    plans[id] = {
      features,
      limits: { ...PLAN_LIMITS[id] },
      card: { ...DEFAULT_CARDS[id], bullets: [...DEFAULT_CARDS[id].bullets] },
    };
  }
  return plans;
}

/**
 * The plan cards' words — 013Fixes / 07, from the owner's spec (§6.8, 7.8,
 * 8.6). The included limits are NOT written here: `limitLines` makes them from
 * the plan's limits, so changing a limit on superadmin changes the card too.
 * Never advertise WhatsApp campaigns, attachments or invoice PDFs.
 */
export const DEFAULT_CARDS = {
  bronze: {
    tagline: 'Essential class management',
    description: 'Organise students, manage class access and run your tuition sessions.',
    bullets: [
      'Student registration and approvals',
      'Secure Zoom and Google Meet class access',
      'Duplicate detection and student management',
      'Individual and bulk blocking',
      'Sessions, classes, subjects and calendar',
      'Private student notes',
      'WhatsApp to one parent at a time',
    ],
  },
  silver: {
    tagline: 'Complete tuition management',
    description: 'Manage classes, track fees and communicate with parents from one place.',
    bullets: [
      'Everything in Bronze',
      'Fee ledger, payment recording and balances',
      'Receipt approval and partial payments',
      'Invoicing and fee-based blocking',
      'Scheduled blocking',
      'Bulk SMS to all students',
    ],
  },
  gold: {
    tagline: 'Advanced management and automation',
    description: 'Automate payment collection and reach exactly the parents or classes you need to contact.',
    bullets: [
      'Everything in Silver',
      'SMS to a chosen session, class, students or staff',
      'M-Pesa payments straight to your Till or Paybill (after Safaricom Go-Live setup)',
      'Payments recorded and reconciled automatically',
    ],
  },
};

/** Card text limits (the superadmin editor and the merge both enforce them). */
export const CARD_LIMITS = { tagline: 80, description: 200, bullets: 10, bullet: 120 };

const KES_NUMBER = (n) => Number(n).toLocaleString('en-KE');

/** The card lines made from a plan's limits. */
export function limitLines(limits) {
  const lines = [
    `Up to ${KES_NUMBER(limits.activeStudents)} active students, ${limits.sessions} sessions and ${limits.logins} dashboard logins`,
  ];
  if (limits.smsUnits > 0) lines.push(`${KES_NUMBER(limits.smsUnits)} SMS units a month included`);
  return lines;
}

/** The plans as shipped in code. Frozen so no caller can edit them in place. */
export const DEFAULT_PLANS = deepFreeze(buildDefaults());

/** No subscription, or an unknown tier: nothing gated is included. */
export const NO_PLAN = deepFreeze({
  features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, false])),
  limits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, 0])),
  card: { tagline: '', description: '', bullets: [] },
});

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const isWholeNumber = (v) => Number.isInteger(v) && v >= 0 && v <= 1_000_000;
const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

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
    const card = { ...base.card, bullets: [...base.card.bullets] };
    if (over && typeof over === 'object') {
      for (const key of FEATURE_KEYS) {
        if (typeof over.features?.[key] === 'boolean') features[key] = over.features[key];
      }
      for (const key of LIMIT_KEYS) {
        if (isWholeNumber(over.limits?.[key])) limits[key] = over.limits[key];
      }
      // 013Fixes / 07: the card's words, each part taken only when well formed.
      if (isText(over.card?.tagline, CARD_LIMITS.tagline)) card.tagline = over.card.tagline.trim();
      if (isText(over.card?.description, CARD_LIMITS.description)) card.description = over.card.description.trim();
      const bullets = over.card?.bullets;
      if (Array.isArray(bullets) && bullets.length > 0 && bullets.length <= CARD_LIMITS.bullets
        && bullets.every((b) => isText(b, CARD_LIMITS.bullet))) {
        card.bullets = bullets.map((b) => b.trim());
      }
    }
    plans[id] = { features, limits, card };
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
