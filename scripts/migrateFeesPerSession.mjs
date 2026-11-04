#!/usr/bin/env node
/**
 * 004Fixes / 10 — split legacy per-number fee accounts into per-session ones.
 * The logic, and what it does and never does: scripts/lib/feesMigration.mjs.
 *
 *   node scripts/migrateFeesPerSession.mjs                     dry run (default): reads, prints counts, writes nothing
 *   node scripts/migrateFeesPerSession.mjs --apply --backup=<file.json>
 *                                                              saves the before-image of every document it will
 *                                                              write to <file>, then writes
 *   node scripts/migrateFeesPerSession.mjs --restore=<file.json>
 *                                                              puts those documents back exactly
 *
 * Uses FIREBASE_SERVICE_ACCOUNT from .env.local (production), or the emulator
 * when FIRESTORE_EMULATOR_HOST is set. Production writes run ONLY on the
 * owner's go-ahead (004Fixes Phase 11), at a quiet hour, before the next fees
 * cron tick after the promote. The output is counts and 6-character hashes.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  const { getDb } = await import('../api/_lib/firebaseAdmin.js');
  const lib = await import('./lib/feesMigration.mjs');
  const db = getDb();

  if (args.restore) {
    console.log(`Restoring ${args.restore} into ${target}…`);
    console.log(JSON.stringify(await lib.restoreBackup(db, args.restore), null, 1));
    return;
  }
  if (args.apply) {
    if (typeof args.backup !== 'string') {
      console.error('✗ --apply needs --backup=<file.json> (the before-image of every document it writes).');
      process.exit(1);
    }
    console.log(`APPLYING to ${target}; backup → ${args.backup}`);
    console.log(JSON.stringify(await lib.applyMigration(db, { backupFile: args.backup }), null, 1));
    return;
  }
  console.log(`DRY RUN against ${target} — nothing is written.`);
  const { report } = await lib.planMigration(db);
  console.log(JSON.stringify(report, null, 1));
}

main().then(() => process.exit(0), (err) => {
  console.error('✗ Migration failed:', err?.message ?? err);
  process.exit(1);
});
