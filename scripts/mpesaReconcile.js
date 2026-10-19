#!/usr/bin/env node
/**
 * Confirm local M-Pesa sandbox payments — `npm run mpesa:reconcile`.
 *
 * Under `npm run dev` the STK callback URL is http://localhost…, which
 * Safaricom cannot reach, so a payment made on the phone is never reported
 * back on its own. This runs the reconcile sweep against the LOCAL API
 * (wrangler dev, :8787) right away: it asks Safaricom for the result of every
 * pending STK push and posts the successful ones to the ledger, exactly as the
 * 10-minute cron does in production.
 *
 * In sandbox mode the usual 2-minute wait is skipped (`minAgeSeconds=0`).
 * If Safaricom is still processing a payment it stays pending — run again.
 *
 *   npm run mpesa:reconcile
 *   npm run mpesa:reconcile -- --api http://127.0.0.1:8787
 *
 * Reads CRON_SECRET from the environment, .dev.vars or .env.local.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readVar(name) {
  if (process.env[name]) return process.env[name];
  for (const file of ['.dev.vars', '.env.local']) {
    const path = resolve(ROOT, file);
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith(`${name}=`)) continue;
      const value = line.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      if (value) return value;
    }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const apiIndex = args.indexOf('--api');
  const api = (apiIndex !== -1 ? args[apiIndex + 1] : process.env.DEV_API_URL) ?? 'http://127.0.0.1:8787';

  const secret = readVar('CRON_SECRET');
  if (!secret) {
    console.error('CRON_SECRET is not set (environment, .dev.vars or .env.local).');
    process.exit(1);
  }

  let response;
  try {
    response = await fetch(`${api.replace(/\/$/, '')}/api/cron/mpesaReconcile?minAgeSeconds=0`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    });
  } catch (err) {
    console.error(`Could not reach the local API at ${api} — is \`npm run dev\` running? (${err?.message ?? err})`);
    process.exit(1);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Reconcile failed (${response.status}): ${JSON.stringify(body)}`);
    process.exit(1);
  }

  const { queried = 0, resolved = 0, posted = 0, deferred = 0, note, skipped } = body;
  if (note === 'nothing pending') {
    console.log('No pending M-Pesa payments.');
    return;
  }
  if (skipped === 'no_credentials') {
    console.log('M-Pesa credentials are not set for the current mode (DARAJA_* in .dev.vars).');
    return;
  }
  // `resolved` counts every payment that reached a verdict, paid ones included.
  const closed = Math.max(0, resolved - posted);
  console.log(`Asked Safaricom about ${queried} payment(s): ${posted} paid and posted to the ledger, ${closed} closed without payment (cancelled, failed or timed out).`);
  if (queried > resolved) console.log('Some are still processing at Safaricom — run this again in a few seconds.');
  if (deferred) console.log(`${deferred} more left for the next run.`);
}

main();
