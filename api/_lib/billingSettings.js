import { getDb, FieldValue } from './firebaseAdmin.js';
import { z } from './validate.js';
import { BILLING_DEFAULTS } from './subscription.js';

/**
 * Billing settings — 013Fixes / 18. `config/billing` (server-only), edited on
 * superadmin and audited; the code defaults (BILLING_DEFAULTS) are the
 * fallback for anything not saved.
 *
 *   trialDays                  the trial's length
 *   countdownHours             when the countdown starts, before the end
 *   cardRenewalToleranceHours  a technical wait for Paystack's renewal webhook
 *                              (not a grace period)
 *
 * Read once per isolate per minute: the sweep, the status read and the
 * webhook all ask, and the settings change a few times a year.
 */

const DOC = 'config/billing';
const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

const int = (min, max) => z.number().int().min(min).max(max);
export const billingSettingsSchema = z.object({
  trialDays: int(1, 90).optional(),
  countdownHours: int(1, 24 * 30).optional(),
  cardRenewalToleranceHours: int(0, 72).optional(),
}).strict();

/** The saved settings over the defaults (only known keys, only valid numbers). */
export function mergeBillingSettings(saved) {
  const out = { ...BILLING_DEFAULTS };
  for (const key of Object.keys(BILLING_DEFAULTS)) {
    const value = saved?.[key];
    if (Number.isInteger(value) && value >= 0) out[key] = value;
  }
  return out;
}

/** Why a full set of settings can't be used, or null. */
export function billingSettingsProblem(s) {
  if (s.countdownHours >= s.trialDays * 24) {
    return 'The countdown must start before the trial does: make it shorter than the trial.';
  }
  return null;
}

export async function readBillingSettings(db = getDb()) {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  try {
    const snap = await db.doc(DOC).get();
    cache = mergeBillingSettings(snap.exists ? snap.data() : null);
  } catch {
    // The defaults rather than a failed request: they are what the code
    // always used, and the next read tries again.
    cache = cache ?? { ...BILLING_DEFAULTS };
  }
  cachedAt = Date.now();
  return cache;
}

export async function saveBillingSettings(db, values, actor) {
  const next = mergeBillingSettings({ ...(await readBillingSettings(db)), ...values });
  await db.doc(DOC).set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor }, { merge: false });
  cache = next;
  cachedAt = Date.now();
  return next;
}

export function invalidateBillingSettings() {
  cache = null;
  cachedAt = 0;
}

/** Test hook. */
export const __resetBillingSettingsCache = invalidateBillingSettings;
