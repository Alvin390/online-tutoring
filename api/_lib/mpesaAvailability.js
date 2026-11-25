import { getDb } from './firebaseAdmin.js';
import { isEnabled } from './flags.js';
import { resolvePlan, schoolPlan } from './schoolPlan.js';
import { credentialSource } from './daraja.js';
import { readMpesaStatus } from './mpesaStatus.js';

/**
 * Can students pay by M-Pesa (STK push) on this deployment?
 *
 * One rule, used by BOTH the payment endpoint (which refuses) and the public
 * bootstrap (which tells the student screen whether to show "Pay now"), so the
 * button can never offer something the server will refuse.
 *
 *   1. the `payments.daraja` flag is on;
 *   2. the deployment's plan includes `mpesaStk` (Gold) — "M-Pesa fee payments
 *      straight to your till" is a Gold feature. The plan comes from `subscription/current`
 *      (a student has no plan of their own), read even when billing
 *      enforcement is off; with billing on, a locked or expired plan is
 *      treated like class links treat it;
 *   3. 013Fixes / 30: the superadmin's switch is on (off = hidden everywhere);
 *   4. M-Pesa keys are set for the current mode (saved live keys, or the
 *      environment's);
 *   5. 013Fixes / 30: it is ONLINE — Safaricom confirmed the KES 1 test, and
 *      nothing changed since.
 *
 * Only STARTING a payment is gated. The callback and the reconcile sweep
 * always accept a payment that has already been made — money is never
 * stranded because a plan changed.
 *
 * @returns {Promise<{available: boolean, reason: null|'feature_disabled'|'plan'|'switched_off'|'not_configured'|'offline'}>}
 */
export async function mpesaAvailability(db = getDb()) {
  if (!(await isEnabled('payments.daraja'))) return { available: false, reason: 'feature_disabled' };

  const [billingOn, subSnap] = await Promise.all([
    isEnabled('billing.enabled'),
    db.doc('subscription/current').get(),
  ]);
  const sub = subSnap.exists ? subSnap.data() : null;
  // 013Fixes / 00: the plan's `mpesaStk` feature (Gold), from this fresh read
  // plus the superadmin's plan settings. The bootstrap is public, so a failed
  // settings read falls back to the shipped plans rather than failing the page.
  const overrides = await schoolPlan(db).then((p) => p.overrides, () => null);
  if (resolvePlan(sub, overrides).features.mpesaStk !== true) return { available: false, reason: 'plan' };
  if (billingOn && (sub.status === 'locked' || sub.status === 'expired')) {
    return { available: false, reason: 'plan' };
  }

  const status = await readMpesaStatus(db);
  if (status.enabled !== true) return { available: false, reason: 'switched_off' };
  if (!(await credentialSource())) return { available: false, reason: 'not_configured' };
  if (status.online !== true) return { available: false, reason: 'offline' };
  return { available: true, reason: null };
}
