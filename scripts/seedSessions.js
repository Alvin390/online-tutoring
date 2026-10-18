#!/usr/bin/env node
/**
 * Session seeding — Phase 05 Part A; a thin wrapper since Phase 13 / 02.
 *
 *   npm run seed:sessions
 *
 * NO LONGER REQUIRED: the default sessions are created automatically, by the
 * server, the first time a teacher opens the dashboard or within the hour by
 * the subscription sweep. This script runs the same function
 * (ensureDefaultSessions in api/_lib/sessions.js) for operators who want to do
 * it explicitly, e.g. on a fresh clone deployment.
 *
 * Why there is no student migration: student documents already live at
 * `sessions/{id}/students/{phone}`, and the session IDs do not change — the
 * slug IS the document ID, and `morning`/`evening` are already valid slugs. The
 * existing data is correctly shaped by accident of the original design.
 *
 * Idempotent and run-once: a second run, or a run after the dashboard already
 * bootstrapped, does nothing. It never overwrites a session or a link.
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === '') process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();

  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(`
  ✗ FIREBASE_SERVICE_ACCOUNT is not set. See .env.example.
`);
    process.exit(1);
  }

  const { getDb } = await import('../api/_lib/firebaseAdmin.js');
  const { ensureDefaultSessions, DEFAULT_SESSIONS } = await import('../api/_lib/sessions.js');

  const db = getDb();
  const outcome = await ensureDefaultSessions(db, { actor: 'script:seedSessions' });

  if (!outcome.ran) {
    console.log(`
  ✓ Sessions were already bootstrapped on this deployment — nothing to do.
    (Default sessions are created once; a deleted default is never recreated.)
`);
    return;
  }

  for (const def of DEFAULT_SESSIONS) {
    const created = outcome.created.includes(def.slug) ? 'created' : 'already existed';
    const link = outcome.migratedLinks.includes(def.slug)
      ? 'link copied from config/zoomLinks'
      : outcome.skippedInvalidLinks.includes(def.slug)
        ? 'existing link is NOT a valid Zoom/Meet URL and was not copied — set it from the dashboard'
        : 'no link copied';
    // count() is implemented by the REST shim since Phase 13 / 02 — this line
    // used to crash the script after the first session.
    // eslint-disable-next-line no-await-in-loop
    const students = (await db.collection(`sessions/${def.slug}/students`).count().get()).data().count;
    console.log(`  ✓ ${def.slug} (${def.name}) — ${created}; ${link}; ${students} student(s)`);
  }

  console.log(`
  ✓ Sessions bootstrapped. Students were not touched.
`);
}

main().catch((err) => {
  console.error('\n  ✗ Seed failed:', err?.message ?? err, '\n');
  process.exit(1);
});
