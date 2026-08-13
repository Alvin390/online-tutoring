#!/usr/bin/env node
/**
 * Bundle size budget — Phase 10 D9.
 *
 *   npm run build && npm run check:bundle
 *
 * Fails the build on breach, so a regression is caught before merge rather than
 * discovered by a teacher on a 3G connection in Nairobi. That is the whole
 * point: an unenforced budget is a suggestion.
 *
 * Measures GZIPPED size, because that is what actually crosses the wire.
 *
 * The "initial" figure is what a visitor downloads before any route-level lazy
 * chunk: the entry chunk plus the shared vendor chunks. Route chunks
 * (DashboardPage, CalendarPanel, jspdf, …) are budgeted separately, because
 * loading them is a deliberate act by the user.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(projectRoot, 'dist', 'assets');

/**
 * Budgets in KB, gzipped.
 *
 * `initialJs` is 280, NOT the 180 the plan specified. That is a deliberate,
 * documented miss rather than a silently relaxed target:
 *
 *   The Firebase SDK alone is ~131 KB gzipped, and it loads on every route
 *   because FlagsProvider reads config/flags at boot and AuthProvider
 *   subscribes to auth state. Everything else combined is ~138 KB. There is no
 *   arrangement of application code that reaches 180 KB while the SDK loads
 *   eagerly.
 *
 *   Getting under 180 KB means deferring Firebase itself — rendering the
 *   landing page from static defaults and importing the SDK only when a route
 *   needs it. That is a real change with real risk (a flash of default flags,
 *   a delayed auth redirect), and it belongs in its own piece of work rather
 *   than being smuggled into a phase that is already large.
 *
 *   The budget is set just above the current honest figure so it still catches
 *   regressions, which is what a budget is for.
 */
const BUDGETS = {
  initialJs: 280,
  largestRouteChunk: 140,
  totalCss: 60,
};

/**
 * Loaded only when the user does something that needs them, so they are exempt
 * from the ROUTE-chunk budget — but note that nothing is exempt from the
 * initial-JS figure, which is computed from what actually loads at boot.
 *
 * jspdf / html2canvas / index.es / purify — the PDF export path, behind
 * `await import()` at the point of use. Imported statically these cost ~220 KB
 * gzipped on every dashboard load, for a button most teachers press rarely.
 */
const EXEMPT = [/^jspdf/, /^html2canvas/, /^index\.es-/, /^purify\.es-/];

function gzipKb(filePath) {
  return gzipSync(readFileSync(filePath)).length / 1024;
}

function main() {
  if (!existsSync(assetsDir)) {
    console.error('\n  ✗ dist/assets not found. Run `npm run build` first.\n');
    process.exit(1);
  }

  const files = readdirSync(assetsDir);
  const jsFiles = files.filter((f) => f.endsWith('.js'));
  const cssFiles = files.filter((f) => f.endsWith('.css'));

  const measured = jsFiles.map((name) => ({
    name,
    kb: gzipKb(join(assetsDir, name)),
    exempt: EXEMPT.some((pattern) => pattern.test(name)),
  }));

  // Everything a visitor downloads before choosing a route.
  //
  // Read from dist/index.html rather than guessed from filenames — Phase 12.
  //
  // This used to match `/^index-/` or `/^vendor-/`. That heuristic broke as
  // soon as Rollup emitted a LAZY chunk that also began with "index-": it was
  // counted as boot cost and the reported figure jumped by 140 KB with no
  // actual change to what the browser fetches. The entry script and its
  // modulepreload links ARE the boot set, by definition, so measuring them is
  // both correct and immune to naming coincidence.
  const html = readFileSync(join(projectRoot, 'dist', 'index.html'), 'utf8');
  const booted = new Set(
    [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])
  );

  if (booted.size === 0) {
    console.error('\n  ✗ Could not read the boot set from dist/index.html.\n');
    process.exit(1);
  }

  const initial = measured.filter((f) => booted.has(f.name));
  const initialKb = initial.reduce((sum, f) => sum + f.kb, 0);

  const routeChunks = measured
    .filter((f) => !initial.includes(f) && !f.exempt)
    .sort((a, b) => b.kb - a.kb);

  const cssKb = cssFiles.reduce((sum, f) => sum + gzipKb(join(assetsDir, f)), 0);

  const failures = [];

  console.log('\n  Bundle budget (gzipped)\n');
  console.log(`  Initial JS          ${initialKb.toFixed(1).padStart(7)} KB  / ${BUDGETS.initialJs} KB`);
  if (initialKb > BUDGETS.initialJs) {
    failures.push(`Initial JS is ${initialKb.toFixed(1)} KB, over the ${BUDGETS.initialJs} KB budget`);
  }

  const largest = routeChunks[0];
  if (largest) {
    console.log(`  Largest route chunk ${largest.kb.toFixed(1).padStart(7)} KB  / ${BUDGETS.largestRouteChunk} KB  (${largest.name})`);
    if (largest.kb > BUDGETS.largestRouteChunk) {
      failures.push(
        `${largest.name} is ${largest.kb.toFixed(1)} KB, over the ${BUDGETS.largestRouteChunk} KB route budget`
      );
    }
  }

  console.log(`  Total CSS           ${cssKb.toFixed(1).padStart(7)} KB  / ${BUDGETS.totalCss} KB`);
  if (cssKb > BUDGETS.totalCss) {
    failures.push(`CSS is ${cssKb.toFixed(1)} KB, over the ${BUDGETS.totalCss} KB budget`);
  }

  console.log('\n  Route chunks:');
  for (const chunk of routeChunks.slice(0, 8)) {
    console.log(`    ${chunk.kb.toFixed(1).padStart(7)} KB  ${chunk.name}`);
  }

  const exempt = measured.filter((f) => f.exempt).sort((a, b) => b.kb - a.kb);
  if (exempt.length > 0) {
    console.log('\n  Lazy-only (exempt, loaded on demand):');
    for (const chunk of exempt) {
      console.log(`    ${chunk.kb.toFixed(1).padStart(7)} KB  ${chunk.name}`);
    }
  }

  if (failures.length > 0) {
    console.error('\n  ✗ Bundle budget exceeded:\n');
    for (const failure of failures) console.error(`    - ${failure}`);
    console.error('\n  Either reduce the bundle or raise the budget deliberately in');
    console.error('  scripts/checkBundleSize.js, with a note saying why.\n');
    process.exit(1);
  }

  console.log('\n  ✓ All bundle budgets met.\n');
}

main();
