import { createHmac } from 'node:crypto';
import { safeCompare } from './crypto.js';
import { ApiError } from './errors.js';
import { paystackMode, paystackVar } from './mode.js';

/**
 * Paystack client — Phase 03 D1/D3/D4.
 *
 * Amounts are handled in the currency SUBUNIT throughout, per
 * paystack_docs.txt:88-90. KES subunit is the cent, so a KES 4,999 plan is
 * 499900. The conversion happens in exactly one place (`toSubunit`) so a
 * factor-of-100 error cannot creep in at a call site — which in a billing
 * system means charging a hundred times too much or too little.
 */

const API_BASE = 'https://api.paystack.co';

/**
 * Paystack's webhook source IPs. A second layer behind signature verification,
 * not a replacement: signature proves authenticity, IP proves origin, and an
 * attacker would need to defeat both.
 */
export const PAYSTACK_IPS = ['52.31.139.75', '52.49.173.169', '52.214.14.220'];

export const TIER_PLAN_ENV = {
  bronze: 'PAYSTACK_PLAN_BRONZE',
  silver: 'PAYSTACK_PLAN_SILVER',
  gold: 'PAYSTACK_PLAN_GOLD',
};

/**
 * Test-mode and live-mode plans are DIFFERENT objects in Paystack with
 * different plan codes, so the mode has to select the code as well as the key.
 * Using a test plan code with a live key fails with an unhelpful error.
 */
export function currentMode() {
  return paystackMode();
}

/**
 * Server-side price table. The client NEVER supplies an amount — that is the
 * classic mass-assignment hole in a checkout flow, and the reason
 * /api/billing/initialize takes a tier name and nothing else.
 */
export const TIER_PRICE_KES = {
  bronze: 4999,
  silver: 7499,
  gold: 9999,
};

export function toSubunit(kes) {
  return Math.round(Number(kes) * 100);
}

export function planCodeForTier(tier) {
  const envName = TIER_PLAN_ENV[tier];
  if (!envName) throw new ApiError(400, 'unknown_tier', `Unknown tier: ${tier}`);

  const code = paystackVar(envName);
  if (!code) {
    throw new ApiError(500, 'plan_not_configured', 'Billing is not fully configured yet.', {
      expose: true,
      cause: new Error(`${envName}_${paystackMode() === 'live' ? 'LIVE' : 'TEST'} is not set`),
    });
  }
  return code;
}

function secretKey() {
  const key = paystackVar('PAYSTACK_SECRET_KEY');
  if (!key) {
    throw new ApiError(500, 'paystack_not_configured', 'Billing is not available right now.', {
      expose: true,
      cause: new Error(
        `PAYSTACK_SECRET_KEY_${paystackMode() === 'live' ? 'LIVE' : 'TEST'} is not set`
      ),
    });
  }

  // A live key while PAYSTACK_MODE=dev means real cards would be charged from
  // what the operator believes is a sandbox. Refuse rather than proceed —
  // this is the one mismatch that costs somebody money.
  if (paystackMode() === 'dev' && key.startsWith('sk_live_')) {
    throw new ApiError(500, 'paystack_mode_mismatch', 'Billing is misconfigured.', {
      expose: true,
      cause: new Error('PAYSTACK_MODE=dev but a live secret key is configured'),
    });
  }

  return key;
}

async function paystackFetch(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.status === false) {
      // Paystack's message is safe to surface — it is written for a merchant,
      // not a stack trace — but the upstream body is not, so it is logged
      // rather than returned.
      throw new ApiError(
        response.status >= 500 ? 502 : 400,
        'paystack_error',
        payload?.message ?? 'The payment provider rejected that request.',
        { cause: new Error(`Paystack ${path}: ${JSON.stringify(payload)}`) }
      );
    }

    return payload.data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err?.name === 'AbortError') {
      throw new ApiError(504, 'paystack_timeout', 'The payment provider did not respond. Please try again.');
    }
    throw new ApiError(502, 'paystack_unreachable', 'Could not reach the payment provider.', {
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------------------
// Customers
// --------------------------------------------------------------------------

export async function findOrCreateCustomer({ email, firstName, lastName }) {
  try {
    return await paystackFetch(`/customer/${encodeURIComponent(email)}`);
  } catch (err) {
    if (err.status !== 400 && err.status !== 404) throw err;
  }

  return paystackFetch('/customer', {
    method: 'POST',
    body: { email, first_name: firstName, last_name: lastName },
  });
}

// --------------------------------------------------------------------------
// Transactions
// --------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} opts.reference        server-generated, recorded before redirect
 * @param {string} opts.callbackUrl
 * @param {string} [opts.planCode]       set for card/bank — Paystack then creates
 *                                       the subscription itself on success
 * @param {number} [opts.amountKes]      set for mobile money (one-off charge)
 * @param {string[]} opts.channels
 * @param {object} opts.metadata
 */
export async function initializeTransaction(opts) {
  const body = {
    email: opts.email,
    reference: opts.reference,
    callback_url: opts.callbackUrl,
    currency: 'KES',
    channels: opts.channels,
    metadata: opts.metadata,
  };

  // `amount` is ALWAYS required, including when subscribing to a plan.
  //
  // This used to send `plan` alone, on the reasonable-sounding theory that an
  // amount next to a plan is how you accidentally charge the wrong price.
  // Paystack disagrees, and the checkout failed with "Invalid Amount Sent" for
  // every card and bank subscription. From the docs shipped with this project:
  //
  //   "While amount is a required parameter, the amount used to create the
  //    plan takes precedence when subscribing to a plan."
  //     — upgrade/paystack_docs.txt:8014
  //
  //   "If transaction is to create a subscription to a predefined plan,
  //    provide plan code here. This would invalidate the value provided in
  //    amount"
  //     — upgrade/paystack_docs.txt:766
  //
  // So the plan's own price wins regardless of what we send, and the original
  // worry does not apply. We send the tier price anyway rather than a
  // placeholder, so that if the plan code is ever wrong the charge is still
  // the right size rather than zero.
  body.amount = toSubunit(opts.amountKes);

  if (opts.planCode) {
    body.plan = opts.planCode;
  }

  return paystackFetch('/transaction/initialize', { method: 'POST', body });
}

export async function verifyTransaction(reference) {
  return paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`);
}

// --------------------------------------------------------------------------
// Subscriptions
// --------------------------------------------------------------------------

export async function disableSubscription({ code, token }) {
  return paystackFetch('/subscription/disable', {
    method: 'POST',
    body: { code, token },
  });
}

export async function fetchSubscription(code) {
  return paystackFetch(`/subscription/${encodeURIComponent(code)}`);
}

// --------------------------------------------------------------------------
// Webhook verification
// --------------------------------------------------------------------------

/**
 * HMAC-SHA512 of the RAW body with the secret key, compared in constant time.
 *
 * Two things this must get right:
 *   - the raw bytes, not a re-serialised parse. Key order, whitespace and
 *     unicode escaping all change the digest.
 *   - constant-time comparison. A plain `===` leaks, byte by byte, how much of
 *     a forged signature was correct.
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;

  const expected = createHmac('sha512', secretKey())
    .update(rawBody)
    .digest('hex');

  return safeCompare(expected, signatureHeader);
}

export function isPaystackIp(ip) {
  return PAYSTACK_IPS.includes(ip);
}
