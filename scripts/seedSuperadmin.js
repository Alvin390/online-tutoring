#!/usr/bin/env node
/**
 * One-time superadmin bootstrap — Phase 02 D2.
 *
 * Run once per deployment against a fresh Firebase project:
 *
 *   npm run seed:superadmin
 *
 * Requires FIREBASE_SERVICE_ACCOUNT, SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD
 * in the environment. Remove the password from the environment afterwards.
 *
 * Per your Q45 answer each deployment gets its OWN superadmin, separate from
 * the teacher's login. Two accounts, two passwords: the teacher must never hold
 * credentials that can grant tiers or read the audit trail.
 *
 * This is the only path that creates a superadmin. /api/admin/setRole requires
 * an existing superadmin to call it, so without this script the role is
 * unreachable — which is the point.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env.local reader — avoids a dotenv dependency for a one-shot script. */
function loadEnvLocal() {
  const path = resolve(projectRoot, '.env.local');
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === '') process.env[key] = value;
  }
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

async function main() {
  loadEnvLocal();

  const email = process.env.SUPERADMIN_EMAIL?.trim();
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    fail('FIREBASE_SERVICE_ACCOUNT is not set. See .env.example.');
  }
  if (!email) fail('SUPERADMIN_EMAIL is not set.');
  if (!password || password.length < 12) {
    fail('SUPERADMIN_PASSWORD must be set and at least 12 characters.');
  }

  const { getAdminAuth, getDb, FieldValue } = await import('../api/_lib/firebaseAdmin.js');
  const { setUserClaims } = await import('../api/_lib/claims.js');

  const auth = getAdminAuth();

  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`  · Account already exists (${user.uid}). Updating claims only.`);
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
    user = await auth.createUser({
      email,
      password,
      emailVerified: true,
      displayName: 'Superadmin',
    });
    console.log(`  · Created account ${user.uid}`);
  }

  const claims = await setUserClaims(user.uid, {
    role: 'superadmin',
    tier: null,
    phone: null,
  });

  await getDb().collection('audit').add({
    action: 'auth.role_granted',
    actor: 'system:seed',
    actorRole: 'system',
    target: user.uid,
    before: null,
    after: claims,
    context: { via: 'npm run seed:superadmin' },
    at: FieldValue.serverTimestamp(),
  });

  console.log(`
  ✓ Superadmin ready.

    uid    ${user.uid}
    claims ${JSON.stringify(claims)}

  Next:
    1. Remove SUPERADMIN_PASSWORD from your environment and from .env.local.
    2. Sign in and enable MFA on this account before go-live.
    3. Provision the teacher account with POST /api/admin/setRole.
    4. Once every staff account carries a role claim, remove the transitional
       'teacher' fallback from isTeacher() in firestore.rules.
`);
}

main().catch((err) => {
  console.error('\n  ✗ Seed failed:', err?.message ?? err, '\n');
  process.exit(1);
});
