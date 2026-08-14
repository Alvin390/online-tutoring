import { randomUUID } from 'node:crypto';
import { createLogger } from '../_lib/log.js';
import { readRawBody } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { verifyWebhookSignature, isPaystackIp, disableSubscription } from '../_lib/paystack.js';
import { clientIp } from '../_lib/rateLimit.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';
import { STATUS, GRACE_PERIOD_MS, publicProjection } from '../_lib/subscription.js';
import { setUserClaims } from '../_lib/claims.js';

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
  if (!verifyWebhookSignature(raw, signature)) {
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

    await processEvent({ db, event, log, requestId });
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

  if (!code) return;
  // Same subscription renewing, not a replacement.
  if (newCode && newCode === code) return;

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
    return;
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
  } catch (err) {
    log.error('Failed to disable the previous subscription', err);
    await tryWriteAudit(
      { action: AuditAction.SUBSCRIPTION_CHANGED, actor: 'system:paystack',
        target: 'subscription:current',
        after: { previousSubscription: code, disabled: false, reason: 'paystack_error' },
        context: { requestId, needsManualAction: true } },
      log
    );
  }
}

async function processEvent({ db, event, log, requestId }) {
  const subRef = db.doc('subscription/current');
  const publicRef = db.doc('subscription/public');
  const data = event.data ?? {};

  const before = (await subRef.get()).data() ?? null;
  let patch = null;

  switch (event.event) {
    case 'charge.success': {
      const metadata = data.metadata ?? {};
      const tier = metadata.tier ?? before?.tier ?? null;
      const renewalMode = metadata.renewalMode ?? before?.renewalMode ?? 'manual';
      const now = Date.now();
      const periodEnd = monthFromNow(now);

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
        tier,
        status: STATUS.ACTIVE,
        renewalMode,
        paymentChannel: data.channel ?? null,
        currentPeriodStart: new Date(now),
        currentPeriodEnd: periodEnd,
        graceEndsAt: null,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        // Reminders are per-period; clear them so the next cycle starts fresh.
        remindersSent: [],
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

      // Apply a downgrade that was scheduled for the period boundary (Q6).
      if (before?.scheduledTierChange?.tier) {
        patch.tier = before.scheduledTierChange.tier;
        patch.scheduledTierChange = null;
      }
      break;
    }

    case 'subscription.create': {
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
      await disablePreviousSubscription({
        before,
        newCode: data.subscription_code ?? null,
        log,
        requestId,
      });

      patch = {
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
      const periodEnd = before?.currentPeriodEnd?.toMillis?.() ?? Date.now();
      patch = {
        status: STATUS.PAST_DUE,
        graceEndsAt: new Date(periodEnd + GRACE_PERIOD_MS),
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
      return;
  }

  if (!patch) return;

  await subRef.set(patch, { merge: true });

  const after = (await subRef.get()).data();

  // Redacted projection for the client. Derived from the same document read
  // that produced `after`, so the two cannot disagree.
  await publicRef.set(publicProjection(after) ?? {}, { merge: false });

  // Keep claims in step with the tier so rules gate correctly. Claims are the
  // fast path; subscription/current stays the authority.
  const uid = data.metadata?.uid ?? before?.uid ?? null;
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
