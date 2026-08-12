#!/usr/bin/env node
/**
 * External API health check.
 *
 *   npm run health      standalone
 *   npm run dev         runs this first, then starts Vite
 *
 * Uses the REAL values from .env.local and makes REAL network calls, so a
 * green line here means the credential actually works — not merely that a
 * variable is non-empty. A key that is present but revoked looks identical to
 * a good one until something tries to use it.
 *
 * NEVER EXITS NON-ZERO. A failing external API must not stop you working on
 * the UI, and most keys are empty on a fresh checkout. Failures are printed
 * loudly with the provider's own error text and the run continues.
 *
 * Nothing secret is ever printed — only which variable was missing, or the
 * provider's error message.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- .env.local loader (no dotenv dependency for a startup script) ----------
function loadEnv() {
  const path = resolve(projectRoot, '.env.local');
  if (!existsSync(path)) return false;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === '') process.env[key] = value;
  }
  return true;
}

// --- terminal formatting ---------------------------------------------------
const supportsColour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, text) => (supportsColour ? `[${code}m${text}[0m` : text);
const green = (t) => c('32', t);
const red = (t) => c('31', t);
const yellow = (t) => c('33', t);
const dim = (t) => c('90', t);
const bold = (t) => c('1', t);

const OK = green('✓ OK  ');
const FAIL = red('✗ FAIL');
const SKIP = yellow('⚠ SKIP');

const results = [];

function record(name, status, detail, ms) {
  results.push({ name, status, detail, ms });
}

function line(name, status, detail, ms) {
  const timing = ms === null ? '' : dim(`${String(ms).padStart(5)}ms`);
  const label = name.padEnd(22);
  console.log(`  ${label} ${status}  ${timing}  ${detail ?? ''}`);
}

async function timed(fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    return { ok: true, ms: Date.now() - started, detail };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err };
  }
}

/** Trims a provider error to one useful line without leaking a payload. */
function briefly(err) {
  const message = err?.message ?? String(err);
  return message.replace(/\s+/g, ' ').slice(0, 140);
}

// --- checks ----------------------------------------------------------------

async function checkFirebaseClient() {
  const required = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
  ];
  const missing = required.filter((k) => !process.env[k]);

  if (missing.length > 0) {
    record('Firebase (client)', 'skip', `missing ${missing.join(', ')}`, null);
    line('Firebase (client)', SKIP, dim(`missing ${missing.join(', ')}`), null);
    return;
  }

  // Verifies the API key and project are real, not just present.
  const result = await timed(async () => {
    const url = `https://identitytoolkit.googleapis.com/v1/projects?key=${process.env.VITE_FIREBASE_API_KEY}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (response.status === 400 || response.status === 403) {
      const body = await response.json().catch(() => null);
      const reason = body?.error?.message ?? `HTTP ${response.status}`;
      // PERMISSION_DENIED here means the key is valid but lacks this scope,
      // which is normal for a browser key — the key itself is fine.
      if (/PERMISSION_DENIED|IDENTITY_TOOLKIT/i.test(reason)) return 'key valid';
      throw new Error(reason);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return 'key valid';
  });

  if (result.ok) {
    record('Firebase (client)', 'ok', null, result.ms);
    line('Firebase (client)', OK, dim(process.env.VITE_FIREBASE_PROJECT_ID), result.ms);
  } else {
    record('Firebase (client)', 'fail', briefly(result.error), result.ms);
    line('Firebase (client)', FAIL, red(briefly(result.error)), result.ms);
  }
}

async function checkFirebaseAdmin() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    const detail = 'FIREBASE_SERVICE_ACCOUNT not set — every /api route will fail';
    record('Firebase Admin', 'skip', detail, null);
    line('Firebase Admin', SKIP, dim(detail), null);
    return;
  }

  const result = await timed(async () => {
    const { getDb } = await import('../api/_lib/firebaseAdmin.js');
    // A real round trip. Reading a document proves credentials AND network.
    await getDb().collection('config').doc('flags').get();
    return 'firestore reachable';
  });

  if (result.ok) {
    record('Firebase Admin', 'ok', null, result.ms);
    line('Firebase Admin', OK, dim('Firestore read'), result.ms);
  } else {
    record('Firebase Admin', 'fail', briefly(result.error), result.ms);
    line('Firebase Admin', FAIL, red(briefly(result.error)), result.ms);
  }
}

async function checkPaystack() {
  const { paystackMode, paystackVar } = await import('../api/_lib/mode.js');
  const mode = paystackMode();
  const key = paystackVar('PAYSTACK_SECRET_KEY');
  const label = `Paystack (${mode})`;

  if (!key) {
    const want = `PAYSTACK_SECRET_KEY_${mode === 'live' ? 'LIVE' : 'TEST'}`;
    record(label, 'skip', `${want} not set`, null);
    line(label, SKIP, dim(`${want} not set`), null);
    return;
  }

  // Mode/key mismatch is worth shouting about: a live key under dev mode means
  // real cards get charged from what looks like a sandbox.
  if (mode === 'dev' && key.startsWith('sk_live_')) {
    record(label, 'fail', 'PAYSTACK_MODE=dev but a LIVE secret key is configured', null);
    line(label, FAIL, red('MODE MISMATCH — dev mode with a live key'), null);
    return;
  }
  if (mode === 'live' && key.startsWith('sk_test_')) {
    record(label, 'fail', 'PAYSTACK_MODE=live but a TEST secret key is configured', null);
    line(label, FAIL, red('MODE MISMATCH — live mode with a test key'), null);
    return;
  }

  const result = await timed(async () => {
    const response = await fetch('https://api.paystack.co/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.status === false) {
      throw new Error(body?.message ?? `HTTP ${response.status}`);
    }
    const balance = body?.data?.[0];
    return balance ? `${balance.currency} balance reachable` : 'authenticated';
  });

  if (result.ok) {
    record(label, 'ok', null, result.ms);
    line(label, OK, dim(result.detail), result.ms);
    checkPaystackPlans(mode);
  } else {
    record(label, 'fail', briefly(result.error), result.ms);
    line(label, FAIL, red(briefly(result.error)), result.ms);
  }
}

function checkPaystackPlans(mode) {
  const suffix = mode === 'live' ? 'LIVE' : 'TEST';
  const missing = ['BRONZE', 'SILVER', 'GOLD'].filter(
    (tier) => !process.env[`PAYSTACK_PLAN_${tier}_${suffix}`]
  );
  if (missing.length > 0) {
    line(
      '  └ plan codes',
      SKIP,
      dim(`missing ${missing.map((t) => `${t}_${suffix}`).join(', ')} — checkout will fail`),
      null
    );
  }
}

async function checkDaraja() {
  const { darajaMode } = await import('../api/_lib/mode.js');
  const mode = darajaMode();
  const label = `M-Pesa Daraja (${mode})`;
  const suffix = mode === 'live' ? 'LIVE' : 'SANDBOX';

  const consumerKey = process.env[`DARAJA_${suffix}_CONSUMER_KEY`];
  const consumerSecret = process.env[`DARAJA_${suffix}_CONSUMER_SECRET`];

  if (!consumerKey || !consumerSecret) {
    const detail = `DARAJA_${suffix}_CONSUMER_KEY/SECRET not set — will fall back to the encrypted Firestore record`;
    record(label, 'skip', detail, null);
    line(label, SKIP, dim(detail), null);
    return;
  }

  const host = mode === 'live' ? 'api.safaricom.co.ke' : 'sandbox.safaricom.co.ke';

  const result = await timed(async () => {
    const basic = Buffer.from(`${consumerKey}:${consumerSecret}`, 'utf8').toString('base64');
    const response = await fetch(
      `https://${host}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${basic}` }, signal: AbortSignal.timeout(15_000) }
    );

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.access_token) {
      throw new Error(
        body?.errorMessage ?? body?.error_description ?? `HTTP ${response.status}`
      );
    }
    // Never print the token. The expiry is the useful signal.
    return `token acquired, expires in ${body.expires_in}s`;
  });

  if (result.ok) {
    record(label, 'ok', null, result.ms);
    line(label, OK, dim(result.detail), result.ms);

    const passkey = process.env[`DARAJA_${suffix}_PASSKEY`];
    const shortcode = process.env[`DARAJA_${suffix}_SHORTCODE`];
    if (!passkey || !shortcode) {
      line(
        '  └ STK push',
        SKIP,
        dim(`missing DARAJA_${suffix}_${!shortcode ? 'SHORTCODE' : 'PASSKEY'} — STK will fail`),
        null
      );
    }
  } else {
    record(label, 'fail', briefly(result.error), result.ms);
    line(label, FAIL, red(briefly(result.error)), result.ms);
  }
}

function checkLocalSecrets() {
  const checks = [
    ['APP_ENCRYPTION_KEY', (v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes base64'],
    ['CRON_SECRET', (v) => v.length >= 16, 'too short — crons will be weakly protected'],
  ];

  for (const [name, valid, hint] of checks) {
    const value = process.env[name];
    if (!value) {
      const detail = name === 'CRON_SECRET'
        ? 'not set — every scheduled job will return 401 and never run'
        : 'not set — Daraja credentials cannot be encrypted';
      record(name, 'skip', detail, null);
      line(name, SKIP, dim(detail), null);
    } else if (!valid(value)) {
      record(name, 'fail', hint, null);
      line(name, FAIL, red(hint), null);
    } else {
      record(name, 'ok', null, null);
      line(name, OK, dim('valid'), null);
    }
  }
}

// --- main ------------------------------------------------------------------

async function main() {
  const found = loadEnv();

  console.log('');
  console.log(bold('  Startup health check'));

  if (!found) {
    console.log(yellow('\n  No .env.local found. Copy .env.example and fill it in.\n'));
    process.exit(0);
  }

  const { describeModes } = await import('../api/_lib/mode.js');
  const modes = describeModes();

  console.log(
    dim(`  Paystack: ${modes.paystack}   Daraja: ${modes.daraja} (${modes.darajaEnvironment})`)
  );
  console.log('');

  await checkFirebaseClient();
  await checkFirebaseAdmin();
  checkLocalSecrets();
  await checkPaystack();
  await checkDaraja();

  const failed = results.filter((r) => r.status === 'fail');
  const skipped = results.filter((r) => r.status === 'skip');
  const ok = results.filter((r) => r.status === 'ok');

  console.log('');
  console.log(
    `  ${green(`${ok.length} healthy`)}   ${yellow(`${skipped.length} not configured`)}   ${failed.length > 0 ? red(`${failed.length} failing`) : dim('0 failing')}`
  );

  if (failed.length > 0) {
    console.log('');
    console.log(red('  Errors to fix:'));
    for (const f of failed) console.log(red(`    ${f.name}: ${f.detail}`));
  }

  if (modes.paystack === 'live' || modes.daraja === 'live') {
    console.log('');
    console.log(red(bold('  ⚠ LIVE MODE — real money will move.')));
  }

  console.log('');

  // Always 0. A failing external API must never stop the dev server.
  process.exit(0);
}

main().catch((err) => {
  console.error(red(`\n  Health check itself failed: ${err?.message ?? err}\n`));
  process.exit(0);
});
