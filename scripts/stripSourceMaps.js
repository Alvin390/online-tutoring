/**
 * Deletes source maps from a build's output — 002Fixes / 10.
 *
 *   node scripts/stripSourceMaps.js [dir=dist]
 *
 * `sourcemap: 'hidden'` writes .map files so they can be uploaded to Sentry,
 * but Workers Assets served whatever was in dist/, so the maps were public.
 * With the Sentry upload configured they are deleted after upload; this makes
 * sure they never ship either way. Deletes *.map files only, nothing else.
 */
import { readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function stripSourceMaps(dir) {
  if (!existsSync(dir)) return [];
  const removed = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) removed.push(...stripSourceMaps(path));
    else if (name.endsWith('.map')) {
      rmSync(path);
      removed.push(path);
    }
  }
  return removed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const dir = process.argv[2] ?? 'dist';
  const removed = stripSourceMaps(dir);
  console.log(`stripSourceMaps: removed ${removed.length} source map(s) from ${dir}`);
}
