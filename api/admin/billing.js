import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { ApiError, badRequest } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';
import {
  readBillingSettings, saveBillingSettings, billingSettingsSchema, mergeBillingSettings, billingSettingsProblem,
} from '../_lib/billingSettings.js';
import { STATUS, publicProjection, toMillis } from '../_lib/subscription.js';
import { invalidatePlanCache } from '../_lib/schoolPlan.js';
import { paymentSchema, checkPayment, preparePaymentInTx } from '../_lib/payments.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TIERS = ['bronze', 'silver', 'gold'];

/**
 * Superadmin billing — 013Fixes / 18.
 *
 *   settings       the billing settings (config/billing over the defaults)
 *   saveSettings   change them: validated, audited
 *   startTrial     013Fixes / 19 (owner answer 6): a package, a length (the
 *                  setting by default) and optionally a payment recorded with
 *                  it. A comp school becomes a trial; a running paid period is
 *                  refused (Change plan is for that). Audited.
 */

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('settings') }).strict(),
  z.object({ action: z.literal('saveSettings'), settings: billingSettingsSchema }).strict(),
  z.object({
    action: z.literal('startTrial'),
    tier: z.enum(TIERS),
    days: z.number().int().min(1).max(90).optional(),
    payment: paymentSchema.optional(),
  }).strict(),
]);

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  rateLimit: { bucket: 'admin_billing', limit: 300, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log, waitUntil }) => {
    const db = getDb();

    if (body.action === 'settings') return { settings: await readBillingSettings(db) };

    if (body.action === 'startTrial') return startTrial({ db, body, user, log, waitUntil });

    // saveSettings
    const before = await readBillingSettings(db);
    const next = mergeBillingSettings({ ...before, ...body.settings });
    const problem = billingSettingsProblem(next);
    if (problem) throw badRequest(problem, 'bad_settings');
    const saved = await saveBillingSettings(db, body.settings, user.uid);
    waitUntil(tryWriteAudit({
      action: 'billing.settings_changed', actor: user.uid, actorRole: user.role, target: 'config/billing',
      before, after: saved, context: { requestId: log.requestId },
    }, log));
    log.info('Billing settings changed');
    return { ok: true, settings: saved };
  },
});

/** 013Fixes / 19: the school into a trial, with or without a recorded payment. */
async function startTrial({ db, body, user, log, waitUntil }) {
  const settings = await readBillingSettings(db);
  const days = body.days ?? settings.trialDays;
  const payment = checkPayment(body.payment);
  const now = Date.now();
  const startAt = new Date(now);
  const endsAt = new Date(now + days * DAY_MS);
  const ref = db.doc('subscription/current');

  const before = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() : null;
    const paidPeriodRunning = current && current.grantedBySuperadmin !== true
      && current.status === STATUS.ACTIVE && (toMillis(current.currentPeriodEnd) ?? 0) > now;
    if (paidPeriodRunning) {
      throw new ApiError(409, 'active_period', 'A paid period is running. Use Change plan instead.');
    }
    const writePayment = payment ? await preparePaymentInTx(tx, db, payment) : null;
    tx.set(ref, {
      tier: body.tier,
      status: STATUS.TRIALING,
      trialEndsAt: endsAt,
      currentPeriodStart: startAt,
      currentPeriodEnd: endsAt,
      // NOT comped: a trial is meant to end, so the sweep must see it.
      grantedBySuperadmin: false,
      renewalMode: 'manual',
      graceEndsAt: null,
      paymentFailedAt: null,
      cancelAtPeriodEnd: false,
      remindersSent: [],
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (writePayment) {
      writePayment({ tier: body.tier, periodFrom: startAt, periodTo: endsAt, kind: 'trial_payment', source: 'manual', actor: user.uid });
    }
    return current;
  });

  invalidatePlanCache();
  const after = (await ref.get()).data();
  await db.doc('subscription/public').set(publicProjection(after, settings) ?? {}, { merge: false });

  waitUntil(tryWriteAudit({
    action: 'billing.trial_started', actor: user.uid, actorRole: user.role, target: 'subscription/current',
    before: { tier: before?.tier ?? null, status: before?.status ?? null, comp: before?.grantedBySuperadmin === true },
    // The amount and method only: an M-Pesa code stays in billing/payments.
    after: { tier: body.tier, days, trialEndsAt: endsAt.toISOString(), payment: payment ? { amountKes: payment.amountKes, method: payment.method } : null },
    context: { requestId: log.requestId },
  }, log));
  log.info('Trial started', { tier: body.tier, days, withPayment: Boolean(payment) });
  return { ok: true, tier: body.tier, days, trialEndsAt: endsAt.toISOString() };
}
