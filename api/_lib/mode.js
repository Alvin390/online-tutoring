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

import { runtimeModes } from './runtimeModes.js';

function normalise(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * 013Fixes / 33a: the superadmin's switch (config/mode.payments, 'live' or
 * 'test') first, then PAYSTACK_MODE, then the safe default (dev = test).
 */
function paystackSetting() {
  const v = runtimeModes().payments;
  return v === 'live' || v === 'test' ? v : null;
}

export function paystackMode() {
  const setting = paystackSetting();
  if (setting) return setting === 'live' ? 'live' : 'dev';
  return normalise(process.env.PAYSTACK_MODE) === 'live' ? 'live' : 'dev';
}

/** Where the Paystack mode came from: 'setting' (superadmin) or 'env'. */
export function paystackModeSource() {
  return paystackSetting() ? 'setting' : 'env';
}

/**
 * 013Fixes / 33b: SMS 'real' or 'fake' — the superadmin's switch
 * (config/mode.sms), then SMS_MODE, then real (today's behaviour). Fake sends
 * nothing to the provider and uses no SMS units.
 */
function smsSetting() {
  const v = runtimeModes().sms;
  return v === 'real' || v === 'fake' ? v : null;
}

export function smsMode() {
  return smsSetting() ?? (normalise(process.env.SMS_MODE) === 'fake' ? 'fake' : 'real');
}

export function smsModeSource() {
  return smsSetting() ? 'setting' : 'env';
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

/**
 * Daraja's variables are INFIX, not suffix: `DARAJA_SANDBOX_CONSUMER_KEY`,
 * not `DARAJA_CONSUMER_KEY_SANDBOX`.
 *
 * This used to call `modeVar`, which appends. Every lookup therefore missed,
 * `credentialsFromEnv()` in ./daraja.js returned null on every call, and M-Pesa
 * silently fell through to the encrypted Firestore record — which only exists
 * if someone has saved credentials through a settings form that was never
 * built. The net effect was that STK push could not work on any deployment,
 * while `scripts/healthCheck.js` reported Daraja healthy because it reads the
 * correct name directly.
 *
 * The infix form is the canonical one: it is what `.env.example`,
 * `upgrade/ENV-SETUP-GUIDE.md`, the uploaded Cloudflare secrets and the health
 * check all use. Only this function disagreed.
 */
export function darajaVar(base) {
  const infix = darajaMode() === 'live' ? 'LIVE' : 'SANDBOX';
  const scoped = base.replace(/^DARAJA_/, `DARAJA_${infix}_`);
  // Unsuffixed fallback kept for the same reason modeVar has one: a deployment
  // predating the split names keeps working.
  return process.env[scoped] || process.env[base] || '';
}

/**
 * 013Fixes / 30b: a Daraja variable for an EXPLICIT environment ('sandbox' or
 * 'production'), by its exact split name — no unsplit fallback, so the
 * card's Demo can never pick up a live key (or Live a sandbox one).
 */
export function darajaVarFor(base, environment) {
  const infix = environment === 'production' ? 'LIVE' : 'SANDBOX';
  return process.env[base.replace(/^DARAJA_/, `DARAJA_${infix}_`)] || '';
}

/** One-line summary for the health check and the startup banner. */
export function describeModes() {
  return {
    paystack: paystackMode(),
    daraja: darajaMode(),
    darajaEnvironment: darajaEnvironment(),
  };
}
