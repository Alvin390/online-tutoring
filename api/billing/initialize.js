import { randomUUID } from 'node:crypto';
import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, tierSchema } from '../_lib/validate.js';
import {
  findOrCreateCustomer,
  initializeTransaction,
  planCodeForTier,
  TIER_PRICE_KES,
} from '../_lib/paystack.js';
import { badRequest } from '../_lib/errors.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';

/**
 * Checkout — Phase 03 D3.
 *
 * THE CONSTRAINT THAT SHAPES THIS ENDPOINT:
 *
 * Paystack's recurring endpoint (Charge Authorization) accepts card or bank
 * only — paystack_docs.txt:1345 — and Subscriptions require a reusable
 * authorization (line 1890). Mobile-money authorizations are not reusable.
 *
 * Therefore a teacher who pays by M-Pesa CANNOT be auto-charged. Handled by
 * branching, not by hiding:
 *
 *   card / bank  → renewalMode 'auto'   → Paystack Subscription, charges itself
 *   mobile_money → renewalMode 'manual' → one-off charge, reminders, re-pay
 *
 * The consequence is stated in the UI at the moment of choice, not buried in
 * terms — see BillingPage.
 *
 * SECURITY: the amount is NEVER taken from the request body. The schema is
 * `.strict()`, so a body carrying `amount` is rejected outright rather than
 * ignored, and the price is looked up server-side from the tier. This is the
 * classic mass-assignment hole in a checkout flow.
 */

const schema = z
  .object({
    tier: tierSchema,
    channel: z.enum(['card', 'bank', 'mobile_money']),
  })
  .strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'billing_initialize', limit: 10, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const { tier, channel } = body;

    if (!user.email) {
      throw badRequest('Your account has no email address, which Paystack requires.');
    }

    const db = getDb();
    const isAuto = channel === 'card' || channel === 'bank';
    const renewalMode = isAuto ? 'auto' : 'manual';

    // Server-generated, recorded BEFORE the redirect, so the webhook can be
    // correlated even if the browser dies between here and the payment page.
    const reference = `sub_${tier}_${randomUUID().replace(/-/g, '')}`;

    const baseUrl = process.env.PUBLIC_BASE_URL ?? '';
    const callbackUrl = `${baseUrl}/billing?ref=${encodeURIComponent(reference)}`;

    const customer = await findOrCreateCustomer({ email: user.email });

    await db.collection('billing').doc('checkouts').collection('items').doc(reference).set({
      reference,
      tier,
      channel,
      renewalMode,
      uid: user.uid,
      customerCode: customer.customer_code,
      amountKes: TIER_PRICE_KES[tier],
      status: 'initialized',
      createdAt: FieldValue.serverTimestamp(),
    });

    const transaction = await initializeTransaction({
      email: user.email,
      reference,
      callbackUrl,
      channels: isAuto ? [channel] : ['mobile_money'],
      // Card/bank pass a plan, so Paystack derives the amount AND creates the
      // subscription. Mobile money is a one-off charge at the tier price.
      ...(isAuto
        ? { planCode: planCodeForTier(tier) }
        : { amountKes: TIER_PRICE_KES[tier] }),
      metadata: {
        uid: user.uid,
        tier,
        renewalMode,
        periodMonths: 1,
      },
    });

    log.info('Checkout initialized', { tier, channel, renewalMode });

    await tryWriteAudit(
      {
        action: AuditAction.SUBSCRIPTION_CREATED,
        actor: user.uid,
        actorRole: user.role,
        target: reference,
        after: { tier, channel, renewalMode, amountKes: TIER_PRICE_KES[tier] },
        context: { requestId: log.requestId },
      },
      log
    );

    return {
      authorizationUrl: transaction.authorization_url,
      reference,
      tier,
      renewalMode,
      amountKes: TIER_PRICE_KES[tier],
      // Surfaced so the UI can restate the consequence after payment, per the
      // "told at the moment of choice" requirement.
      autoRenews: isAuto,
    };
  },
});
