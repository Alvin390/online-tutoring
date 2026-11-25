import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { ApiError, badRequest } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';
import {
  readBillingSettings, saveBillingSettings, billingSettingsSchema, mergeBillingSettings, billingSettingsProblem,
} from '../_lib/billingSettings.js';
import { STATUS, publicProjection, toMillis, paidWindow, paymentPatch } from '../_lib/subscription.js';
import { invalidatePlanCache } from '../_lib/schoolPlan.js';
import {
  paymentSchema, checkPayment, preparePaymentInTx, listPayments, paystackPaymentRef, paystackPaymentRecord,
} from '../_lib/payments.js';
import { verifyTransaction } from '../_lib/paystack.js';
import { setUserClaims } from '../_lib/claims.js';
import { cleanSchoolOverrides, hasSchoolOverrides } from '../_lib/schoolOverrides.js';
import { FEATURE_KEYS, LIMIT_KEYS } from '../_lib/plans.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// 013Fixes / 22: a school's own limits and features (only known keys).
const schoolOverridesSchema = z.object({
  limits: z.object(Object.fromEntries(LIMIT_KEYS.map((k) => [k, z.number().int().min(0).max(1_000_000).optional()]))).strict(),
  features: z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean().optional()]))).strict(),
}).strict();
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
 *   recordPayment  013Fixes / 20 (owner answers 7 and 8; Q6: always one
 *                  calendar month): a school that paid the owner directly.
 *                  Locked → the month starts now; early → it is queued from
 *                  the current end. The plan follows the package paid for.
 *                  `preview: true` returns the window and writes nothing.
 *                  A school paying by card automatically is refused (cancel
 *                  the card first, or it is charged twice). Audited.
 *   payments       013Fixes / 21: every payment, newest first, 20 a page,
 *                  with codes and notes (the school's list hides them)
 *   backfillPayments  013Fixes / 21: in-app payments from before the webhook
 *                  recorded them, from billing/events through Paystack's
 *                  verify. A dry run by default (counts, calls nobody);
 *                  `apply: true` writes at most BACKFILL_BATCH a run. Audited.
 *
 * 013Fixes / 22 — the account card's actions (owner suggestions 2-4, 8),
 * each audited. Gift (comp) and Cancel reuse /api/billing/manage.
 *   changePlan     the package, now (a queued package is dropped); the
 *                  period stays. Refused for a card school.
 *   extend         N days on the trial or period end (and a queued month);
 *                  the reminders start again. Never a new period start (that
 *                  would open a fresh SMS window). Refused when locked
 *                  (Unlock), gifted (no end) or paying by card (the next
 *                  charge would undo it).
 *   lock           locked now; a gift ends (the sweep must see the school).
 *   unlock         active until a date (then it locks again); with a paid
 *                  month queued, open until that month begins instead.
 *   notes / saveNotes   private notes on the school, with their history
 *                  (config/accountNotes, closed to every browser).
 *   saveOverrides  the school's own limits and features on top of its plan.
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
  z.object({ action: z.literal('payments'), cursor: z.number().int().positive().optional() }).strict(),
  z.object({ action: z.literal('changePlan'), tier: z.enum(TIERS) }).strict(),
  z.object({ action: z.literal('extend'), days: z.number().int().min(1).max(365) }).strict(),
  z.object({ action: z.literal('lock') }).strict(),
  z.object({ action: z.literal('unlock'), until: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('notes') }).strict(),
  z.object({
    action: z.literal('saveNotes'),
    contact: z.string().trim().max(2000).optional(),
    agreedPrice: z.string().trim().max(2000).optional(),
    promises: z.string().trim().max(2000).optional(),
  }).strict(),
  schoolOverridesSchema.extend({ action: z.literal('saveOverrides') }).strict(),
  z.object({ action: z.literal('backfillPayments'), apply: z.boolean().optional() }).strict(),
  paymentSchema.extend({
    action: z.literal('recordPayment'),
    tier: z.enum(TIERS),
    preview: z.boolean().optional(),
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

    if (body.action === 'recordPayment') return recordPayment({ db, body, user, log, waitUntil });

    if (body.action === 'payments') return listPayments(db, { cursor: body.cursor ?? null });

    if (body.action === 'backfillPayments') return backfillPayments({ db, body, user, log, waitUntil });

    if (ACCOUNT_ACTIONS[body.action]) return ACCOUNT_ACTIONS[body.action]({ db, body, user, log, waitUntil });

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
    // 013Fixes / 20: a paid period queued behind a trial counts too.
    const paidPeriodRunning = current && current.grantedBySuperadmin !== true
      && ((current.status === STATUS.ACTIVE && (toMillis(current.currentPeriodEnd) ?? 0) > now)
        || toMillis(current.nextPeriodStart) != null);
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
      nextPeriodStart: null, nextTier: null, // 013Fixes / 20: a trial replaces any queued period
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

/**
 * A card subscription renews by itself, and can still charge AFTER its end
 * (the renewal wait, Paystack's retries — even once locked). A manual payment
 * on top would be paid twice, so it is refused until the card is cancelled.
 */
function cardRenewing(sub) {
  return sub?.renewalMode === 'auto' && Boolean(sub?.paystackSubscriptionCode)
    && sub?.status !== STATUS.CANCELLED && sub?.status !== STATUS.EXPIRED
    && sub?.grantedBySuperadmin !== true;
}

/** 013Fixes / 20: a payment made to the owner directly, recorded by the superadmin. */
async function recordPayment({ db, body, user, log, waitUntil }) {
  const { action: _action, tier, preview, ...rest } = body; // eslint-disable-line no-unused-vars
  const payment = checkPayment(rest);
  const ref = db.doc('subscription/current');
  const now = Date.now();

  if (preview) {
    const current = (await ref.get()).data() ?? null;
    if (cardRenewing(current)) throw cardActive();
    const w = paidWindow(current, now);
    return { ok: true, preview: true, tier, window: { from: w.from, to: w.to, startsNow: w.from <= now } };
  }

  const settings = await readBillingSettings(db);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() : null;
    if (cardRenewing(current)) throw cardActive();
    const writePayment = await preparePaymentInTx(tx, db, payment);
    const { window, patch } = paymentPatch(current, { tier, now, renewalMode: 'manual' });
    tx.set(ref, {
      ...patch,
      lastPaymentAt: new Date(now),
      lastPaymentAmountKes: payment.amountKes,
      lastPaymentMethod: payment.method,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    writePayment({ tier, periodFrom: new Date(window.from), periodTo: new Date(window.to), kind: 'payment', source: 'manual', actor: user.uid });
    return { before: current, window };
  });

  invalidatePlanCache();
  const after = (await ref.get()).data();
  await db.doc('subscription/public').set(publicProjection(after, settings) ?? {}, { merge: false });

  const { before, window } = result;
  waitUntil(tryWriteAudit({
    action: 'billing.payment_recorded', actor: user.uid, actorRole: user.role, target: 'subscription/current',
    before: { tier: before?.tier ?? null, status: before?.status ?? null, currentPeriodEnd: toIso(before?.currentPeriodEnd) },
    // The amount and method only: an M-Pesa code stays in billing/payments.
    after: { tier, status: after?.status ?? null, amountKes: payment.amountKes, method: payment.method, from: new Date(window.from).toISOString(), to: new Date(window.to).toISOString() },
    context: { requestId: log.requestId },
  }, log));
  log.info('Payment recorded', { tier, method: payment.method, startsNow: window.from <= now });
  return { ok: true, tier, window: { from: window.from, to: window.to, startsNow: window.from <= now } };
}

function cardActive() {
  return new ApiError(409, 'card_active', 'This school pays by card automatically. Cancel the card subscription first, or it will be charged twice.');
}

function toIso(t) {
  const ms = toMillis(t);
  return ms == null ? null : new Date(ms).toISOString();
}

// Each verify is one subrequest; a run stays well inside the Worker's budget.
const BACKFILL_BATCH = 20;

/** 013Fixes / 21: past in-app payments into the history, once each. */
async function backfillPayments({ db, body, user, log, waitUntil }) {
  const [events, recorded] = await Promise.all([
    db.collection('billing').doc('events').collection('items').where('event', '==', 'charge.success').get(),
    db.collection('billing/payments/items').where('source', '==', 'paystack').get(),
  ]);
  const have = new Set(recorded.docs.map((d) => d.id));
  const references = [...new Set(events.docs.map((d) => d.data().reference).filter(Boolean))];
  const missing = references.filter((ref) => !have.has(paystackPaymentRef(db, ref).id));

  if (!body.apply) {
    return { ok: true, applied: false, charges: references.length, missing: missing.length };
  }

  let written = 0;
  let skipped = 0;
  let failed = 0;
  const batch = missing.slice(0, BACKFILL_BATCH);
  for (const reference of batch) {
    try {
      const tx = await verifyTransaction(reference);
      if (tx?.status !== 'success' || typeof tx.amount !== 'number') { skipped += 1; continue; }
      const paidAt = tx.paid_at ?? tx.paidAt ?? tx.created_at ?? null;
      await paystackPaymentRef(db, reference).create({
        ...paystackPaymentRecord({
          reference,
          amountKes: tx.amount / 100,
          channel: tx.channel ?? null,
          tier: tx.metadata?.tier ?? null,
          // The period each one bought was not kept before this phase.
          periodFrom: null,
          periodTo: null,
          paidAt: paidAt ? new Date(paidAt) : null,
        }),
        backfilled: true,
      });
      written += 1;
    } catch (err) {
      if (err?.code === 6 || err?.code === 'already-exists') { skipped += 1; continue; }
      failed += 1;
      log.warn('Backfill: a payment could not be fetched or written', { error: String(err?.message ?? err) });
    }
  }

  const result = { written, skipped, failed, remaining: missing.length - batch.length };
  waitUntil(tryWriteAudit({
    action: 'billing.payments_backfilled', actor: user.uid, actorRole: user.role, target: 'billing/payments',
    after: result, context: { requestId: log.requestId },
  }, log));
  log.info('Payments backfilled', result);
  return { ok: true, applied: true, charges: references.length, missing: missing.length, ...result };
}

// ------------------------------------------------------------ 013Fixes / 22

const NOTE_FIELDS = ['contact', 'agreedPrice', 'promises'];

/**
 * Read the subscription in a transaction, decide, write; then the cache, the
 * projection, the owner's claims and the audit — the same for every action.
 * `decide(current, now)` returns { patch, audit, result } or throws.
 */
async function changeSubscription({ db, user, log, waitUntil }, action, decide) {
  const ref = db.doc('subscription/current');
  const now = Date.now();
  const { before, decision } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() : null;
    if (!current) throw new ApiError(409, 'no_subscription', 'This school has no subscription yet. Start a trial first.');
    const d = decide(current, now);
    tx.set(ref, { ...d.patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { before: current, decision: d };
  });

  invalidatePlanCache();
  const settings = await readBillingSettings(db);
  const after = (await ref.get()).data();
  await db.doc('subscription/public').set(publicProjection(after, settings) ?? {}, { merge: false });

  // Claims are only the screens' stand-in until the server's plan arrives;
  // kept in step anyway, so they never lag by the sweep's hour.
  const owner = after?.ownerUid;
  if (owner && after?.tier) {
    try {
      await setUserClaims(owner, { tier: after.tier, subActive: after.status === STATUS.ACTIVE || after.status === STATUS.TRIALING });
    } catch (err) {
      log.warn('Owner claims not synced after an account action', { action, error: String(err?.message ?? err) });
    }
  }

  waitUntil(tryWriteAudit({
    action, actor: user.uid, actorRole: user.role, target: 'subscription/current',
    before: { tier: before?.tier ?? null, status: before?.status ?? null, ...(decision.audit?.before ?? {}) },
    after: { tier: after?.tier ?? null, status: after?.status ?? null, ...(decision.audit?.after ?? {}) },
    context: { requestId: log.requestId },
  }, log));
  log.info('Account action', { action });
  return { ok: true, ...(decision.result ?? {}) };
}

const shift = (t, by) => {
  const v = toMillis(t);
  return v == null ? null : new Date(v + by);
};

const ACCOUNT_ACTIONS = {
  changePlan: (ctx) => changeSubscription(ctx, 'billing.plan_changed', (current) => {
    if (cardRenewing(current)) throw cardActive();
    return {
      patch: { tier: ctx.body.tier, nextTier: null },
      result: { tier: ctx.body.tier },
    };
  }),

  extend: (ctx) => changeSubscription(ctx, 'billing.extended', (current) => {
    const { days } = ctx.body;
    if (current.grantedBySuperadmin === true) throw new ApiError(409, 'comp', 'A gifted plan has no end to extend.');
    if (cardRenewing(current)) throw cardActive();
    if (![STATUS.TRIALING, STATUS.ACTIVE, STATUS.CANCELLED].includes(current.status)) {
      throw new ApiError(409, 'not_running', 'The school is not running a trial or period. Use Unlock until, or Record payment.');
    }
    const by = days * DAY_MS;
    const patch = { remindersSent: [] };
    if (current.status === STATUS.TRIALING && current.trialEndsAt != null) patch.trialEndsAt = shift(current.trialEndsAt, by);
    if (current.currentPeriodEnd != null) patch.currentPeriodEnd = shift(current.currentPeriodEnd, by);
    if (current.nextPeriodStart != null) patch.nextPeriodStart = shift(current.nextPeriodStart, by);
    return {
      patch,
      audit: { before: { currentPeriodEnd: toIso(current.currentPeriodEnd) }, after: { days, currentPeriodEnd: toIso(patch.currentPeriodEnd) } },
      result: { days, currentPeriodEnd: toMillis(patch.currentPeriodEnd) },
    };
  }),

  lock: (ctx) => changeSubscription(ctx, 'billing.locked', (current, now) => ({
    patch: {
      status: STATUS.LOCKED,
      // A gift short-circuits the state machine: kept, Unlock could never end.
      grantedBySuperadmin: false,
      lockedBySuperadmin: true,
      lockedAt: new Date(now),
      graceEndsAt: null,
    },
    audit: { before: { comp: current.grantedBySuperadmin === true } },
  })),

  unlock: (ctx) => changeSubscription(ctx, 'billing.unlocked', (current, now) => {
    const { until } = ctx.body;
    if (until <= now) throw badRequest('Choose a date in the future.', 'bad_date');
    if (until > now + 366 * DAY_MS) throw badRequest('Choose a date within a year.', 'bad_date');
    if (current.status !== STATUS.LOCKED && current.status !== STATUS.EXPIRED) {
      throw new ApiError(409, 'not_locked', 'The school is not locked.');
    }
    const common = {
      status: STATUS.ACTIVE,
      grantedBySuperadmin: false,
      lockedBySuperadmin: false,
      graceEndsAt: null,
      paymentFailedAt: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      remindersSent: [],
    };
    const queued = toMillis(current.nextPeriodStart);
    if (queued != null && queued > now) {
      // A paid month is waiting: open until it begins; the rollover does the rest.
      return { patch: common, audit: { after: { until: new Date(queued).toISOString(), queued: true } }, result: { until: queued, queued: true } };
    }
    return {
      // The period start is kept: a new one would open a fresh SMS window.
      patch: { ...common, renewalMode: 'manual', currentPeriodEnd: new Date(until), nextPeriodStart: null, nextTier: null },
      audit: { after: { until: new Date(until).toISOString() } },
      result: { until, queued: false },
    };
  }),

  notes: async ({ db }) => {
    const ref = db.doc('config/accountNotes');
    const [snap, hist] = await Promise.all([
      ref.get(),
      ref.collection('history').orderBy('at', 'desc').limit(10).get(),
    ]);
    const n = snap.exists ? snap.data() : null;
    return {
      notes: n ? { ...pick(n), updatedAt: toMillis(n.updatedAt), updatedBy: n.updatedBy ?? null } : null,
      history: hist.docs.map((d) => {
        const h = d.data();
        return { at: toMillis(h.at), actor: h.actor ?? null, before: h.before ?? {}, after: h.after ?? {} };
      }),
    };
  },

  saveNotes: async ({ db, body, user, log, waitUntil }) => {
    const ref = db.doc('config/accountNotes');
    const next = pick(body);
    const changed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const before = snap.exists ? pick(snap.data()) : pick({});
      const fields = NOTE_FIELDS.filter((k) => before[k] !== next[k]);
      if (fields.length === 0) return [];
      tx.set(ref, { ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid });
      tx.create(ref.collection('history').doc(), {
        at: FieldValue.serverTimestamp(),
        actor: user.uid,
        before: Object.fromEntries(fields.map((k) => [k, before[k]])),
        after: Object.fromEntries(fields.map((k) => [k, next[k]])),
      });
      return fields;
    });
    if (changed.length > 0) {
      // Which fields changed, never their text (contact details, prices).
      waitUntil(tryWriteAudit({
        action: 'billing.notes_changed', actor: user.uid, actorRole: user.role, target: 'config/accountNotes',
        after: { fields: changed }, context: { requestId: log.requestId },
      }, log));
    }
    return { ok: true, changed };
  },

  saveOverrides: async ({ db, body, user, log, waitUntil }) => {
    const ref = db.doc('subscription/current');
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(409, 'no_subscription', 'This school has no subscription yet. Start a trial first.');
    const before = cleanSchoolOverrides(snap.data().schoolOverrides);
    const next = cleanSchoolOverrides({ limits: body.limits, features: body.features });
    // update(), not a merge-set: the whole map is replaced, so a key taken out is gone.
    await ref.update({
      schoolOverrides: hasSchoolOverrides(next) ? next : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    invalidatePlanCache();
    const after = (await ref.get()).data();
    await db.doc('subscription/public').set(publicProjection(after, await readBillingSettings(db)) ?? {}, { merge: false });
    waitUntil(tryWriteAudit({
      action: 'billing.overrides_changed', actor: user.uid, actorRole: user.role, target: 'subscription/current',
      before, after: next, context: { requestId: log.requestId },
    }, log));
    log.info('School overrides changed', { custom: hasSchoolOverrides(next) });
    return { ok: true, schoolOverrides: next, custom: hasSchoolOverrides(next) };
  },
};

function pick(source) {
  return Object.fromEntries(NOTE_FIELDS.map((k) => [k, typeof source?.[k] === 'string' ? source[k].trim() : '']));
}
