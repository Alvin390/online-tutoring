#!/usr/bin/env node
/**
 * Session seeding — Phase 05 Part A.
 *
 *   npm run seed:sessions
 *
 * Creates the `morning` and `evening` session documents and copies any existing
 * links out of `config/zoomLinks` into each session's PRIVATE subcollection.
 *
 * Why there is no student migration: student documents already live at
 * `sessions/{id}/students/{phone}`, and the session IDs do not change — the
 * slug IS the document ID, and `morning`/`evening` are already valid slugs. The
 * existing data is correctly shaped by accident of the original design.
 *
 * Idempotent. Re-running updates presentation fields and re-copies links
 * without touching students.
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

const DEFAULTS = [
  {
    slug: 'morning',
    name: 'Morning Session',
    icon: 'bi-sunrise-fill',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    order: 0,
  },
  {
    slug: 'evening',
    name: 'Evening Session',
    icon: 'bi-moon-stars-fill',
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    order: 1,
  },
];

async function main() {
  loadEnvLocal();

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('\n  ✗ FIREBASE_SERVICE_ACCOUNT is not set. See .env.example.\n');
    process.exit(1);
  }

  const { getDb, FieldValue } = await import('../api/_lib/firebaseAdmin.js');
  const { parseClassLink } = await import('../api/_lib/classLink.js');

  const db = getDb();

  // Existing links, if any.
  const legacySnap = await db.doc('config/zoomLinks').get();
  const legacy = legacySnap.exists ? legacySnap.data() : {};

  for (const session of DEFAULTS) {
    const ref = db.doc(`sessions/${session.slug}`);
    const existing = await ref.get();

    await ref.set(
      {
        name: session.name,
        slug: session.slug,
        icon: session.icon,
        gradient: session.gradient,
        order: session.order,
        active: true,
        schedule: null,
        ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const legacyUrl = legacy[session.slug];
    if (legacyUrl) {
      const parsed = parseClassLink(legacyUrl);
      if (parsed.valid) {
        await db.doc(`sessions/${session.slug}/private/classLink`).set(
          {
            url: parsed.url,
            provider: parsed.provider,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: 'system:seed',
          },
          { merge: true }
        );
        console.log(`  · ${session.slug}: copied ${parsed.provider} link into private/classLink`);
      } else {
        // Reported, not silently dropped. An invalid stored link is exactly the
        // sort of thing the old substring check would have accepted.
        console.warn(
          `  ! ${session.slug}: existing link is not a valid Zoom or Meet URL and was NOT copied.\n` +
          `    Reason: ${parsed.error}\n` +
          `    Set it again from the dashboard.`
        );
      }
    } else {
      console.log(`  · ${session.slug}: no existing link to copy`);
    }

    const studentCount = (await ref.collection('students').count().get()).data().count;
    console.log(`  ✓ ${session.slug} (${session.name}) — ${studentCount} student(s) already present`);
  }

  console.log(`
  ✓ Sessions seeded.

  Students were NOT touched: they already live at sessions/{id}/students/{phone}
  and the IDs are unchanged.

  Next: flip sessions.teacherDefined to true in config/flags once you have
  confirmed /morning and /evening still resolve.
`);
}

main().catch((err) => {
  console.error('\n  ✗ Seed failed:', err?.message ?? err, '\n');
  process.exit(1);
});
