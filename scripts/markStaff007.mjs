#!/usr/bin/env node
/**
 * 007Fixes / 11 — mark the teachers the owner confirmed as staff.
 * The logic, and what it does and never does: scripts/lib/markStaffConfirmed.mjs
 * (it marks through api/_lib/staff.js, exactly as the dashboard does).
 *
 *   node scripts/markStaff007.mjs --targets=<file.json>                          dry run (default)
 *   node scripts/markStaff007.mjs --targets=<file.json> --apply --backup=<file.json>
 *   node scripts/markStaff007.mjs --restore=<file.json>
 *
 * --targets is a LOCAL file (full numbers; never committed): { targets: [{ session, phone }] }.
 * Uses FIREBASE_SERVICE_ACCOUNT from .env.local (production), or the emulator
 * when FIRESTORE_EMULATOR_HOST is set. Production writes only on the owner's
 * go-ahead, after Release B is live (007Fixes Phase 12). Output: counts only.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnvLocal() {
  const p = resolve(projectRoot, '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env) || process.env[key] === '') process.env[key] = value;
  }
}
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) loadEnvLocal();
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('✗ FIREBASE_SERVICE_ACCOUNT is not set (or set FIRESTORE_EMULATOR_HOST for the emulator).');
    process.exit(1);
  }
  const target = process.env.FIRESTORE_EMULATOR_HOST ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` : 'PRODUCTION';
  const { getDb } = await import(pathToFileURL(resolve(projectRoot, 'api/_lib/firebaseAdmin.js')).href);
  const lib = await import(pathToFileURL(resolve(projectRoot, 'scripts/lib/markStaffConfirmed.mjs')).href);
  const db = getDb();

  if (args.restore) {
    console.log(`Restoring ${args.restore} into ${target}…`);
    console.log(JSON.stringify(await lib.restoreMarkStaff(db, args.restore), null, 1));
    return;
  }
  if (typeof args.targets !== 'string') {
    console.error('✗ --targets=<file.json> is required.');
    process.exit(1);
  }
  const { targets } = JSON.parse(readFileSync(args.targets, 'utf8'));
  if (args.apply) {
    if (typeof args.backup !== 'string') {
      console.error('✗ --apply needs --backup=<file.json>.');
      process.exit(1);
    }
    console.log(`APPLYING to ${target}; backup → ${args.backup}`);
    console.log(JSON.stringify(await lib.applyMarkStaff(db, targets, { backupFile: args.backup }), null, 1));
    return;
  }
  console.log(`DRY RUN against ${target} — nothing is written.`);
  console.log(JSON.stringify(await lib.planMarkStaff(db, targets), null, 1));
}

main().then(() => process.exit(0), (err) => {
  console.error('✗ Marking failed:', err?.message ?? err);
  process.exit(1);
});
