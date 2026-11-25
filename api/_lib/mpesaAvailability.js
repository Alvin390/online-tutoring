import { getDb } from './firebaseAdmin.js';
import { isEnabled } from './flags.js';
import { resolvePlan, schoolPlan } from './schoolPlan.js';
import { credentialSource, loadCredentials, credentialsFingerprint } from './daraja.js';
import { readMpesaStatus, modeOf, isLiveTested } from './mpesaStatus.js';

/**
 * Can students pay by M-Pesa (STK push) on this deployment — and how?
 *
 * One rule, used by BOTH the payment endpoint (which refuses) and the public
 * bootstrap (which tells the student screen whether to show "Pay now"), so the
 * button can never offer something the server will refuse.
 *
 *   1. the `payments.daraja` flag is on;
 *   2. the plan includes `mpesaStk` (Gold), and (with billing on) isn't
 *      locked or expired;
 *   3. 013Fixes / 30b — the superadmin's setting (config/mpesaStatus.mode):
 *        off  → no
 *        demo → yes, through the SANDBOX (the server's sandbox keys); a demo
 *               payment never touches fees or blocks
 *        live → yes only with live keys whose fingerprint matches the
 *               confirmed KES 1 test ("tested"); untested → no
 *
 * Only STARTING a payment is gated. The callback and the reconcile sweep
 * always accept a live payment that has already been made — money is never
 * stranded because a setting changed.
 *
 * @returns {Promise<{available: boolean, demo: boolean, environment: null|'sandbox'|'production',
 *   reason: null|'feature_disabled'|'plan'|'switched_off'|'not_configured'|'offline'}>}
 */
export async function mpesaAvailability(db = getDb()) {
  const no = (reason) => ({ available: false, demo: false, environment: null, reason });
  if (!(await isEnabled('payments.daraja'))) return no('feature_disabled');

  const [billingOn, subSnap] = await Promise.all([
    isEnabled('billing.enabled'),
    db.doc('subscription/current').get(),
  ]);
  const sub = subSnap.exists ? subSnap.data() : null;
  // 013Fixes / 00: the plan's `mpesaStk` feature (Gold), from this fresh read
  // plus the superadmin's plan settings. The bootstrap is public, so a failed
  // settings read falls back to the shipped plans rather than failing the page.
  const overrides = await schoolPlan(db).then((p) => p.overrides, () => null);
  if (resolvePlan(sub, overrides).features.mpesaStk !== true) return no('plan');
  if (billingOn && (sub.status === 'locked' || sub.status === 'expired')) return no('plan');

  const status = await readMpesaStatus(db);
  const mode = modeOf(status);
  if (mode === 'off') return no('switched_off');
  if (mode === 'demo') {
    if (!(await credentialSource({ environment: 'sandbox' }))) return no('not_configured');
    return { available: true, demo: true, environment: 'sandbox', reason: null };
  }
  const live = await loadCredentials({ environment: 'production' }).catch(() => null);
  if (!live) return no('not_configured');
  if (!isLiveTested(status, credentialsFingerprint(live))) return no('offline');
  return { available: true, demo: false, environment: 'production', reason: null };
}
