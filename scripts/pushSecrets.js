#!/usr/bin/env node
/**
 * Uploads runtime secrets to Cloudflare — Phase 12 D9.
 *
 * There are two DIFFERENT kinds of variable in this project and mixing them up
 * is the usual way a deploy breaks:
 *
 *   VITE_*        BUILD-time. Vite inlines them into the browser bundle, so
 *                 they are public by construction and must never hold a secret.
 *                 They stay in .env.local and this script ignores them.
 *
 *   everything    RUNTIME. Read by the Worker through process.env. They must be
 *   else          uploaded to Cloudflare as encrypted secrets; they are NOT in
 *                 the bundle and NOT in wrangler.jsonc.
 *
 * Reads .dev.vars (preferred) or .env.local, and pipes each runtime value into
 * `wrangler secret put`.
 *
 * Usage:
 *   npm run cf:secrets              upload everything that has a value
 *   npm run cf:secrets -- --dry-run list what WOULD be uploaded, no values
 *   npm run cf:secrets -- --only PAYSTACK_SECRET_KEY_LIVE
 *
 * Never prints a secret's value — only its name and length.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex !== -1 ? args[onlyIndex + 1] : null;

/**
 * Runtime variables that are NOT secrets and live in wrangler.jsonc `vars`
 * instead. Uploading them as secrets would work but hides ordinary tuning
 * knobs behind an opaque store.
 */
const PLAIN_VARS = new Set(['SUBREQUEST_BUDGET', 'SWEEP_BATCH_SIZE', 'EXPOSE_DEV_OTP']);

/**
 * A local-development URL that must not be uploaded to production.
 *
 * `.dev.vars` is the LOCAL file, so `PUBLIC_BASE_URL=http://localhost:3000` is
 * correct there and catastrophic in Cloudflare: it is the base for the Paystack
 * return URL and the Daraja callback URL, and Safaricom cannot call localhost.
 * The failure is silent — payments simply never come back — so this refuses
 * rather than warns.
 */
function isLocalhostUrl(value) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(value);
}

function parseEnvFile(path) {
  const out = new Map();
  const text = readFileSync(path, 'utf8');

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const at = line.indexOf('=');
    if (at === -1) continue;

    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();

    // Strip one layer of matching quotes, which people add around JSON blobs
    // like FIREBASE_SERVICE_ACCOUNT.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }

    if (key) out.set(key, value);
  }

  return out;
}

function main() {
  const devVars = resolve(ROOT, '.dev.vars');
  const envLocal = resolve(ROOT, '.env.local');
  const source = existsSync(devVars) ? devVars : envLocal;

  if (!existsSync(source)) {
    console.error('No .dev.vars or .env.local found. Nothing to upload.');
    process.exit(1);
  }

  console.log(`Reading ${source === devVars ? '.dev.vars' : '.env.local'}\n`);

  const entries = parseEnvFile(source);

  const candidates = [...entries.entries()].filter(([key, value]) => {
    if (key.startsWith('VITE_')) return false;   // build-time, public
    if (PLAIN_VARS.has(key)) return false;        // wrangler.jsonc vars
    if (isLocalhostUrl(value)) return false;      // local-only, see below
    if (only) return key === only;
    return value.length > 0;                      // never upload a blank
  });

  const localOnly = [...entries.entries()].filter(
    ([key, value]) => !key.startsWith('VITE_') && !PLAIN_VARS.has(key) && isLocalhostUrl(value)
  );

  if (localOnly.length > 0) {
    console.log('REFUSED (points at localhost — would break in production):');
    for (const [key, value] of localOnly) console.log(`  - ${key} = ${value}`);
    console.log(
      '  Set these by hand to the deployed origin, e.g.\n'
      + '    npx wrangler secret put PUBLIC_BASE_URL\n'
      + '  then update the Paystack callback URL and the Daraja callback URL to match.\n'
    );
  }

  const empty = [...entries.keys()].filter(
    (key) => !key.startsWith('VITE_') && !PLAIN_VARS.has(key) && !entries.get(key)
  );

  if (empty.length > 0) {
    console.log('SKIPPED (no value set yet):');
    for (const key of empty) console.log(`  - ${key}`);
    console.log('  See upgrade/ENV-SETUP-GUIDE.md for where to get each one.\n');
  }

  if (candidates.length === 0) {
    console.log('Nothing to upload.');
    return;
  }

  console.log(`${dryRun ? 'WOULD UPLOAD' : 'UPLOADING'} ${candidates.length} secret(s):`);

  let failed = 0;

  for (const [key, value] of candidates) {
    console.log(`  ${key} (${value.length} chars)`);
    if (dryRun) continue;

    // The value goes in on stdin, never as an argv element — arguments are
    // visible in the process table and in shell history.
    const result = spawnSync('npx', ['wrangler', 'secret', 'put', key], {
      input: value,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    });

    if (result.status !== 0) {
      console.error(`    FAILED: ${key}`);
      failed += 1;
    }
  }

  if (dryRun) {
    console.log('\nDry run — nothing was uploaded.');
    return;
  }

  console.log(failed === 0 ? '\nDone.' : `\nDone, with ${failed} failure(s).`);

  if (failed === 0) {
    // Secrets attach to the WORKER, not to a version that was already
    // uploaded. A preview URL minted before this point keeps the bindings it
    // was built with — which is exactly how a deployment ends up reporting
    // `credentials: "missing"` on /api/health after the secrets "were set".
    console.log(
      '\nUpload a new version so it picks these up:\n'
      + '  npx wrangler versions upload      (preview URL)\n'
      + '  npx wrangler deploy               (production)\n'
      + '\nThen confirm:  curl https://<url>/api/health\n'
      + '  expected: {"status":"ok","firestore":"ok","credentials":"ok",...}\n'
    );
  }

  if (failed > 0) process.exit(1);
}

main();
