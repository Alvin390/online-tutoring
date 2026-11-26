import { randomUUID } from 'node:crypto';
import { createLogger } from '../_lib/log.js';
import { readRawBody } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import {
  verifyWebhookSignature,
  signedByOtherMode,
  isPaystackIp,
  disableSubscription,
  tierForPlanCode,
} from '../_lib/paystack.js';
import { TIER_RANK } from '../_lib/auth.js';
import { clientIp } from '../_lib/rateLimit.js';
import { eventOwnership, ignoredSummary } from '../_lib/webhookOwnership.js';
import { paystackMode } from '../_lib/mode.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';
import { STATUS, publicProjection, paymentPatch } from '../_lib/subscription.js';
import { readBillingSettings } from '../_lib/billingSettings.js';
import { setUserClaims } from '../_lib/claims.js';
import { paystackPaymentRef, paystackPaymentRecord } from '../_lib/payments.js';
import { planPrices, acceptedPrices } from '../_lib/planPrices.js';
import { invalidatePlanCache } from '../_lib/schoolPlan.js';

/**
 * Paystack webhook — Phase 03 D4. The most security-sensitive endpoint here.
 *
 * This handler deliberately does NOT use createHandler: that chain parses JSON,
 * and signature verification needs the exact raw bytes Paystack signed.
 * Re-serialising a parsed object does not reliably reproduce them (key order,
 * whitespace, unicode escapes), so the signature would fail intermittently and
 * for reasons that look like nothing.
 *
 * Order of operations, and none of it is negotiable:
 *   1. Signature verification, BEFORE parsing. An unverified body is untrusted
 *      input, and JSON.parse on untrusted input is work an attacker can buy.
 *   2. IP allowlist as a second layer.
 *   3. Idempotency: Paystack's event ID is the document ID, so a duplicate
 *      delivery collides and is dropped. Paystack retries — this is not optional.
 *   4. Respond 200 fast. A 500 makes Paystack retry forever.
 */

// Vercel must not pre-parse the body, or the raw bytes are gone.
export const config = {
  api: { bodyParser: false },
};

const HANDLED_EVENTS = new Set([
  'charge.success',
  'subscription.create',
  'subscription.disable',
  'subscription.not_renew',
  'invoice.create',
  'invoice.update',
  'invoice.payment_failed',
]);

function monthFromNow(from = Date.now()) {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

export default async function handler(req, res) {
  const requestId = randomUUID();
  const log = createLogger(requestId);

  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch {
    return res.status(413).json({ error: { code: 'payload_too_large' } });
  }

  // --- 1. Signature, before parsing.
  const signature = req.headers['x-paystack-signature'];
  const verified = verifyWebhookSignature(raw, signature);

  // 013Fixes / 33a: an event for the OTHER Paystack mode (the superadmin's
  // switch, or PAYSTACK_MODE) — signed with the other mode's key, or carrying
  // the other domain. Refused (409) and never processed, so a test event can
  // never grant a plan on live; Paystack retries, so a real event that reaches
  // an isolate still on the old mode (≤ 30 s) is not lost.
  const wrongMode = async (detail) => {
    log.warn('Webhook for the other Paystack mode refused', { mode: paystackMode(), detail });
    await tryWriteAudit({
      action: AuditAction.WEBHOOK_REJECTED,
      actor: 'paystack',
      context: { reason: 'wrong_mode', mode: paystackMode() === 'live' ? 'live' : 'test', detail, ip: clientIp(req), requestId },
    }, log);
    return res.status(409).json({ error: { code: 'wrong_mode' } });
  };
  if (!verified && signedByOtherMode(raw, signature)) return wrongMode('key');

  if (!verified) {
    log.warn('Webhook signature verification failed', { ip: clientIp(req) });

    await tryWriteAudit(
      {
        action: AuditAction.WEBHOOK_REJECTED,
        actor: 'paystack',
        context: { reason: 'bad_signature', ip: clientIp(req), requestId },
      },
      log
    );

    // 401 and nothing written. Never 500 — that would tell an attacker their
    // forged payload got far enough to break something.
    return res.status(401).json({ error: { code: 'invalid_signature' } });
  }

  // --- 2. IP allowlist. Logged rather than enforced when PAYSTACK_ENFORCE_IP
  // is unset, because Paystack's ranges can change and a silent hard block on
  // billing callbacks is a worse failure than a soft one. Signature already
  // proves authenticity.
  const ip = clientIp(req);
  if (!isPaystackIp(ip)) {
    log.warn('Webhook from unexpected IP', { ip });
    if (process.env.PAYSTACK_ENFORCE_IP === 'true') {
      return res.status(403).json({ error: { code: 'forbidden_source' } });
    }
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: { code: 'invalid_json' } });
  }

  // `domain` is inside the signed body: 'live' or 'test'.
  const domain = event?.data?.domain;
  if ((domain === 'live' || domain === 'test') && domain !== (paystackMode() === 'live' ? 'live' : 'test')) {
    return wrongMode('domain');
  }

  const eventId = String(
    event?.id ?? event?.data?.id ?? `${event?.event}_${event?.data?.reference ?? randomUUID()}`
  );

  const db = getDb();
  const eventRef = db.collection('billing').doc('events').collection('items').doc(eventId);

  try {
    // --- 3. Idempotency. `create` fails if the document exists, so a replayed
    // delivery is a no-op by construction rather than by a read-then-write race.
    try {
      await eventRef.create({
        event: event.event,
        receivedAt: FieldValue.serverTimestamp(),
        reference: event?.data?.reference ?? null,
        status: 'received',
        requestId,
      });
    } catch (err) {
      if (err?.code === 6 || err?.code === 'already-exists') {
        log.info('Duplicate webhook ignored', { event: event.event });
        return res.status(200).json({ ok: true, duplicate: true });
      }
      throw err;
    }

    if (!HANDLED_EVENTS.has(event.event)) {
      // Unknown events are logged and 200'd. A 500 makes Paystack retry
      // forever on an event we were never going to act on.
      log.info('Unhandled webhook event type', { event: event.event });
      await eventRef.set({ status: 'ignored' }, { merge: true });
      return res.status(200).json({ ok: true, ignored: true });
    }

    const outcome = await processEvent({ db, event, log, requestId });

    // 013Fixes / 39: not this school's event (another payment on the same
    // Paystack account, another school's subscription, a KES 100 check) —
    // 200 so Paystack doesn't retry it, but recorded and audited loudly: the
    // event record is the only trace if a real payment were ever refused.
    if (outcome === 'not_ours' || outcome === 'expected') {
      const ignored = ignoredSummary(event);
      await eventRef.set({ status: outcome, ignored }, { merge: true });
      if (outcome === 'not_ours') {
        log.warn('Webhook event is not for this school; ignored', { event: event.event, reference: ignored.reference });
        await tryWriteAudit({
          action: 'billing.webhook_ignored', actor: 'paystack', target: 'subscription/current',
          context: { reason: 'not_ours', ...ignored, requestId },
        }, log);
      } else {
        log.info('Disable of a subscription the app turned off itself; nothing to change', { code: ignored.subscriptionCode });
      }
      return res.status(200).json({ ok: true, ignored: outcome });
    }
    await eventRef.set({ status: 'processed' }, { merge: true });

    return res.status(200).json({ ok: true });
  } catch (err) {
    log.error('Webhook processing failed', err);
    await eventRef.set({ status: 'failed', error: String(err?.message ?? err) }, { merge: true })
      .catch(() => {});

    // 200 even on failure. The event is recorded as 'failed' and the cron
    // reconciles from Paystack; making Paystack retry a poison event forever
    // is worse than reconciling one ourselves.
    return res.status(200).json({ ok: true, deferred: true });
  }
}

/**
 * Turns off the subscription a new one is replacing.
 *
 * Never throws. A webhook that 500s makes Paystack retry the whole event, and
 * the subscription record has already been updated correctly by the time this
 * matters — a failed disable is a billing problem to chase, not a reason to
 * reprocess a payment. It is logged and audited so it can be found.
 *
 * @param {object|null} before   the subscription document before this event
 * @param {string|null} newCode  the incoming subscription code, if any
 */
async function disablePreviousSubscription({ before, newCode, log, requestId }) {
  const code = before?.paystackSubscriptionCode ?? null;
  const token = before?.paystackEmailToken ?? null;

  if (!code) return null;
  // Same subscription renewing, not a replacement.
  if (newCode && newCode === code) return null;

  if (!token) {
    // Without the email token Paystack will not accept the disable. Recorded
    // rather than swallowed: this one has to be finished by hand in the
    // Paystack dashboard or it bills forever.
    log.error('Cannot disable the previous subscription: no stored email token', { code });
    await tryWriteAudit(
      { action: AuditAction.SUBSCRIPTION_CHANGED, actor: 'system:paystack',
        target: 'subscription:current',
        after: { previousSubscription: code, disabled: false, reason: 'missing_email_token' },
        context: { requestId, needsManualAction: true } },
      log
    );
    return null;
  }

  try {
    await disableSubscription({ code, token });
    log.info('Previous subscription disabled', { code });
    await tryWriteAudit(
      { action: AuditAction.SUBSCRIPTION_CHANGED, actor: 'system:paystack',
        target: 'subscription:current',
        after: { previousSubscription: code, disabled: true },
        context: { requestId, change: 'superseded' } },
      log
    );
    // 013Fixes / 39: the caller records it, so Paystack's disable event for
    // it is expected rather than a cancellation.
    return code;
  } catch (err) {
    log.error('Failed to disable the previous subscription', err);
    await tryWriteAudit(
      { action: AuditAction.SUBSCRIPTION_CHANGED, actor: 'system:paystack',
        target: 'subscription:current',
        after: { previousSubscription: code, disabled: false, reason: 'paystack_error' },
        context: { requestId, needsManualAction: true } },
      log
    );
    return null;
  }
}

async function processEvent({ db, event, log, requestId }) {
  const subRef = db.doc('subscription/current');
  const publicRef = db.doc('subscription/public');
  const data = event.data ?? {};

  const before = (await subRef.get()).data() ?? null;
  // 013Fixes / 39: only this school's events change it.
  const ownership = await eventOwnership(db, event, before);
  if (ownership !== 'ours') return ownership;
  let patch = null;
  // 013Fixes / 21: the payment's own record (payment history).
  let payment = null;

  switch (event.event) {
    case 'charge.success': {
      const metadata = data.metadata ?? {};
      // Phase 13 / 05 D2 — the tier is what was PAID FOR: the charged plan's
      // tier first (a recurring card charge carries no metadata), then the
      // checkout's metadata, then the current tier.
      const paidTier = tierForPlanCode(data.plan?.plan_code) ?? metadata.tier ?? before?.tier ?? null;
      const tier = paidTier;
      const renewalMode = metadata.renewalMode ?? before?.renewalMode ?? 'manual';
      const now = Date.now();
      // 013Fixes / 20: an M-Pesa (one-time) payment follows the window rule —
      // early extends from the current end, locked starts now. A card
      // subscription keeps Paystack's dates (subscription.create sets the end
      // from next_payment_date), so it starts now as before.
      // Only an EXPLICIT metadata.renewalMode 'manual' (our M-Pesa checkout,
      // api/billing/initialize.js) takes the rule. A recurring card charge
      // carries no metadata, and the stored mode can be stale: the live
      // school is gifted, stored 'manual', and still holds an old Paystack
      // subscription; routing on the stored mode would end its gift.
      const manual = metadata.renewalMode === 'manual' ? paymentPatch(before, { tier, now, renewalMode }) : null;
      const windowFields = manual
        ? manual.patch
        : {
          tier,
          status: STATUS.ACTIVE,
          currentPeriodStart: new Date(now),
          currentPeriodEnd: monthFromNow(now),
          nextPeriodStart: null,
          nextTier: null,
          graceEndsAt: null,
          trialEndsAt: null,
          cancelAtPeriodEnd: false,
          paymentFailedAt: null,
          remindersSent: [],
        };

      // Switching from a card subscription to M-Pesa. No `subscription.create`
      // fires for mobile money, so without this the old card subscription keeps
      // auto-charging alongside the manual payments.
      //
      // The condition is deliberately narrow. `metadata.renewalMode` is set by
      // us at checkout (api/billing/initialize.js), so 'manual' here means a
      // person just chose to pay by M-Pesa. A RECURRING card charge cannot
      // reach this branch — a manual checkout never produces recurring charges
      // — so this can never disable a healthy subscription on its own renewal.
      if (metadata.renewalMode === 'manual') {
        await disablePreviousSubscription({ before, newCode: null, log, requestId });
      }

      patch = {
        renewalMode,
        paymentChannel: data.channel ?? null,
        // The period (begun now or queued — then the tier waits in nextTier),
        // with grace, a failed payment
        // (013Fixes / 18: the countdown stops) and cancel cleared; reminders
        // are per-period, so a period begun now clears them.
        ...windowFields,
        paystackCustomerCode: data.customer?.customer_code ?? before?.paystackCustomerCode ?? null,
        // Only a reusable (card/bank) authorization is worth storing. Storing a
        // mobile-money one would imply a recurring capability that does not exist.
        paystackAuthorizationCode:
          data.authorization?.reusable === true
            ? data.authorization.authorization_code
            : before?.paystackAuthorizationCode ?? null,
        lastPaymentAt: new Date(now),
        lastPaymentAmountKes: typeof data.amount === 'number' ? data.amount / 100 : null,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (data.reference && typeof data.amount === 'number') {
        payment = {
          reference: data.reference,
          amountKes: data.amount / 100,
          channel: data.channel ?? null,
          tier: patch.tier ?? patch.nextTier ?? null,
          periodFrom: manual ? new Date(manual.window.from) : new Date(now),
          periodTo: manual ? new Date(manual.window.to) : patch.currentPeriodEnd,
        };
      }

      if (metadata.uid) patch.ownerUid = metadata.uid;
      if (data.plan?.plan_code) patch.paystackPlanCode = data.plan.plan_code;

      const scheduled = before?.scheduledTierChange;
      if (scheduled?.tier) {
        const isUpgrade = metadata.tier
          && (TIER_RANK[metadata.tier] ?? 0) > (TIER_RANK[before?.tier] ?? 0);

        if (isUpgrade) {
          // An upgrade always wins (B9b): the pending cheaper subscription has
          // not charged yet, so switch it off and drop the schedule.
          patch.tier = metadata.tier;
          patch.scheduledTierChange = null;
          if (scheduled.newSubscriptionCode) {
            try {
              await disableSubscription({ code: scheduled.newSubscriptionCode, token: scheduled.newEmailToken });
            } catch (err) {
              log.error('Could not disable the pending downgrade subscription after an upgrade', err);
              await tryWriteAudit(
                { action: AuditAction.SUBSCRIPTION_CHANGED, actor: 'system:paystack', target: 'subscription:current',
                  after: { subscription: scheduled.newSubscriptionCode, disabled: false, reason: 'upgrade_superseded_downgrade' },
                  context: { requestId, needsManualAction: true } },
                log
              );
            }
          }
        } else if (paidTier === scheduled.tier) {
          // The cheaper plan's first charge: the downgrade takes effect now,
          // and the subscription being billed becomes the current one.
          patch.tier = scheduled.tier;
          patch.scheduledTierChange = null;
          if (scheduled.newSubscriptionCode) {
            patch.paystackSubscriptionCode = scheduled.newSubscriptionCode;
            patch.paystackEmailToken = scheduled.newEmailToken ?? null;
          }
        }
        // Otherwise: a renewal still on the old plan (e.g. a manual renewal
        // before the boundary). The schedule stays.
      }

      // The price should match the plan. A mismatch (a stale price on the
      // Paystack plan, say) is recorded loudly — but the money has moved, so
      // it is not rejected. 013Fixes / 25: the plan's price is Paystack's;
      // around a change, the price before it and the amount the checkout was
      // started with count too.
      const paidTierNow = patch.tier ?? patch.nextTier;
      const [priceInfo, checkoutSnap] = await Promise.all([
        planPrices(db),
        data.reference ? db.doc(`billing/checkouts/items/${data.reference}`).get().catch(() => null) : null,
      ]);
      const checkoutKes = checkoutSnap?.exists ? checkoutSnap.data().amountKes ?? null : null;
      const expectedKes = priceInfo.prices[paidTierNow];
      const paidKes = typeof data.amount === 'number' ? data.amount / 100 : null;
      if (expectedKes && paidKes != null && !acceptedPrices(paidTierNow, priceInfo, checkoutKes).has(paidKes)) {
        log.warn('Charged amount does not match the tier price', { tier: patch.tier ?? patch.nextTier, paidKes, expectedKes });
        await tryWriteAudit(
          { action: 'billing.price_mismatch', actor: 'system:paystack', target: 'subscription/current',
            after: { tier: patch.tier ?? patch.nextTier, paidKes, expectedKes },
            context: { requestId, reference: data.reference ?? null } },
          log
        );
      }
      break;
    }

    case 'subscription.create': {
      // Phase 13 / 05 D1: the replacement a scheduled downgrade created. It is
      // not a new purchase — it must neither disable the paid subscription
      // early nor become the current one before its first charge. Recorded
      // only.
      if (data.subscription_code
          && data.subscription_code === before?.scheduledTierChange?.newSubscriptionCode) {
        log.info('Scheduled downgrade subscription confirmed by Paystack', { code: data.subscription_code });
        patch = {
          scheduledTierChange: {
            ...before.scheduledTierChange,
            newEmailToken: data.email_token ?? before.scheduledTierChange.newEmailToken ?? null,
            confirmedByPaystack: true,
          },
          updatedAt: FieldValue.serverTimestamp(),
        };
        break;
      }

      // A NEW subscription replaces the old one, so the old one has to be shut
      // off or Paystack bills both every month.
      //
      // This is the bug that made changing plan expensive: nothing anywhere
      // disabled the previous subscription, and the line below then overwrote
      // `paystackSubscriptionCode` with the new code — so the old subscription
      // kept charging AND the app no longer held the code needed to cancel it.
      // The only way out was the Paystack dashboard.
      //
      // Done HERE rather than at checkout time on purpose: the replacement is
      // known to exist at this point. Disabling when checkout merely STARTS
      // would leave a teacher who abandoned the page with no active
      // subscription and no charge to show for it.
      const replaced = await disablePreviousSubscription({
        before,
        newCode: data.subscription_code ?? null,
        log,
        requestId,
      });

      patch = {
        // 013Fixes / 39: Paystack will report the replaced one as disabled.
        ...(replaced ? { disabledByApp: FieldValue.arrayUnion(replaced) } : {}),
        status: STATUS.ACTIVE,
        renewalMode: 'auto',
        paystackSubscriptionCode: data.subscription_code ?? null,
        paystackPlanCode: data.plan?.plan_code ?? null,
        paystackEmailToken: data.email_token ?? null,
        currentPeriodEnd: data.next_payment_date ? new Date(data.next_payment_date) : monthFromNow(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      break;
    }

    case 'subscription.disable':
    case 'subscription.not_renew': {
      // Access continues to the end of the paid period (Q8).
      patch = {
        cancelAtPeriodEnd: true,
        status: STATUS.CANCELLED,
        updatedAt: FieldValue.serverTimestamp(),
      };
      break;
    }

    case 'invoice.payment_failed': {
      // 013Fixes / 18: the school stays active and the countdown starts now
      // (billingWindow); it locks at the period end plus the renewal wait
      // unless a payment arrives. No grace after the end.
      patch = {
        paymentFailedAt: before?.paymentFailedAt ?? new Date(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      break;
    }

    case 'invoice.create':
    case 'invoice.update': {
      patch = {
        lastInvoiceAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      break;
    }

    default:
      return 'processed';
  }

  if (!patch) return 'processed';

  await subRef.set(patch, { merge: true });
  invalidatePlanCache();

  // 013Fixes / 21: one record per Paystack reference (set, so a replay that
  // got past the event check cannot make two).
  if (payment) {
    const finalTier = patch.tier ?? patch.nextTier ?? payment.tier;
    await paystackPaymentRef(db, payment.reference).set(paystackPaymentRecord({ ...payment, tier: finalTier }));
  }

  const after = (await subRef.get()).data();

  // Redacted projection for the client. Derived from the same document read
  // that produced `after`, so the two cannot disagree.
  await publicRef.set(publicProjection(after, await readBillingSettings(db)) ?? {}, { merge: false });

  // Keep claims in step with the tier so rules gate correctly. Claims are the
  // fast path; subscription/current stays the authority.
  // Phase 13 / 05 D4: a recurring charge carries no metadata, so the owner
  // stored at checkout is the fallback (it used to be `before.uid`, a field
  // nothing ever wrote — renewals never synced claims).
  const uid = data.metadata?.uid ?? before?.ownerUid ?? before?.uid ?? null;
  if (uid && after?.tier) {
    try {
      await setUserClaims(uid, {
        tier: after.tier,
        subActive: after.status === STATUS.ACTIVE || after.status === STATUS.TRIALING,
      });
    } catch (err) {
      log.error('Failed to sync claims after webhook', err);
    }
  }

  log.info('Webhook processed', { event: event.event, status: after?.status, tier: after?.tier });

  await tryWriteAudit(
    {
      action: AuditAction.WEBHOOK_RECEIVED,
      actor: 'paystack',
      target: 'subscription/current',
      before: before ? { status: before.status, tier: before.tier } : null,
      after: { status: after?.status, tier: after?.tier },
      context: { event: event.event, requestId },
    },
    log
  );
}
