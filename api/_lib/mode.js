/**
 * dev / live mode resolution for the two payment providers.
 *
 * `PAYSTACK_MODE` and `DARAJA_MODE` are INDEPENDENT, deliberately. They are
 * different companies with different approval timelines: Daraja production
 * needs Safaricom sign-off that takes days, while Paystack live mode is a
 * dashboard toggle. Forcing one switch for both would mean either testing
 * M-Pesa against live card billing, or blocking real subscriptions until
 * Safaricom replies.
 *
 * Both key sets live in the environment at once and the mode chooses. Switching
 * is one word, with no key shuffling and no chance of leaving a live key active
 * because it was pasted over a test one.
 *
 * Anything other than the exact string 'live' is treated as dev. The default
 * direction has to be the safe one — a typo in this variable must never
 * silently start charging real cards.
 */

function normalise(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function paystackMode() {
  return normalise(process.env.PAYSTACK_MODE) === 'live' ? 'live' : 'dev';
}

export function darajaMode() {
  return normalise(process.env.DARAJA_MODE) === 'live' ? 'live' : 'dev';
}

/** Daraja's own naming, for the endpoint table and the stored record. */
export function darajaEnvironment() {
  return darajaMode() === 'live' ? 'production' : 'sandbox';
}

/**
 * Reads a mode-suffixed variable, falling back to the unsuffixed name.
 *
 * The fallback keeps a pre-existing `PAYSTACK_SECRET_KEY` working rather than
 * breaking a deployment that has not been migrated to the split names yet.
 */
export function modeVar(base, mode, { suffixes = { dev: 'TEST', live: 'LIVE' } } = {}) {
  const suffix = suffixes[mode];
  return process.env[`${base}_${suffix}`] || process.env[base] || '';
}

export function paystackVar(base) {
  return modeVar(base, paystackMode());
}

/** Daraja uses SANDBOX/LIVE rather than TEST/LIVE. */
export function darajaVar(base) {
  return modeVar(base, darajaMode(), { suffixes: { dev: 'SANDBOX', live: 'LIVE' } });
}

/** One-line summary for the health check and the startup banner. */
export function describeModes() {
  return {
    paystack: paystackMode(),
    daraja: darajaMode(),
    darajaEnvironment: darajaEnvironment(),
  };
}
