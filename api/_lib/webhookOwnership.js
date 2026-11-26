import { tierForPlanCode } from './paystack.js';

/**
 * Is this Paystack event THIS school's? — 013Fixes / 39 (owner, 2026-11-26).
 *
 * One Paystack account can carry other payments (a payment link, a KES 100
 * live check, another school sharing the account's plans), and before this
 * the webhook acted on all of them: any successful charge extended this
 * school's plan; any new subscription became its own; any disable cancelled
 * it. Each event is now tied to the school by its own identifiers:
 *
 *   charge.success       a checkout this school recorded for the reference;
 *                        or one of our plans charged to a customer this school
 *                        knows; or metadata.uid of a user of this school
 *   subscription.create  a customer this school knows, or the replacement a
 *                        scheduled downgrade created
 *   subscription.disable / not_renew  the school's CURRENT subscription only;
 *                        one the app disabled itself (a plan change) is
 *                        'expected' and changes nothing
 *   invoice.*            the school's subscription code, or a known customer
 *
 * A customer is known when it is stored on the school or recorded on one of
 * its checkouts (api/billing/initialize.js stores the customer code before
 * redirecting, so a subscription.create arriving before its charge matches).
 *
 * @returns {Promise<'ours'|'not_ours'|'expected'>}
 */
export async function eventOwnership(db, event, before) {
  const data = event?.data ?? {};
  const customer = data.customer?.customer_code ?? null;

  const knownCustomer = async () => {
    if (!customer) return false;
    if (before?.paystackCustomerCode === customer) return true;
    const q = await db.collection('billing/checkouts/items').where('customerCode', '==', customer).limit(1).get();
    return !q.empty;
  };

  switch (event?.event) {
    case 'charge.success': {
      if (data.reference) {
        const checkout = await db.doc(`billing/checkouts/items/${data.reference}`).get();
        if (checkout.exists) return 'ours';
      }
      if (tierForPlanCode(data.plan?.plan_code) && (await knownCustomer())) return 'ours';
      const uid = data.metadata?.uid;
      if (typeof uid === 'string' && uid && !uid.includes('/') && (await db.doc(`users/${uid}`).get()).exists) return 'ours';
      return 'not_ours';
    }
    case 'subscription.create': {
      const code = data.subscription_code;
      if (code && code === before?.scheduledTierChange?.newSubscriptionCode) return 'ours';
      return (await knownCustomer()) ? 'ours' : 'not_ours';
    }
    case 'subscription.disable':
    case 'subscription.not_renew': {
      const code = data.subscription_code;
      if (!code || code !== before?.paystackSubscriptionCode) return 'not_ours';
      return (before?.disabledByApp ?? []).includes(code) ? 'expected' : 'ours';
    }
    case 'invoice.payment_failed':
    case 'invoice.create':
    case 'invoice.update': {
      const code = data.subscription?.subscription_code;
      if (code && code === before?.paystackSubscriptionCode) return 'ours';
      return (await knownCustomer()) ? 'ours' : 'not_ours';
    }
    default:
      return 'ours';
  }
}

/** What the event record keeps about an ignored event: identifiers, never a person. */
export function ignoredSummary(event) {
  const data = event?.data ?? {};
  return {
    event: event?.event ?? null,
    reference: data.reference ?? null,
    customerCode: data.customer?.customer_code ?? null,
    planCode: data.plan?.plan_code ?? null,
    subscriptionCode: data.subscription_code ?? data.subscription?.subscription_code ?? null,
    amountKes: typeof data.amount === 'number' ? data.amount / 100 : null,
    domain: data.domain ?? null,
  };
}
