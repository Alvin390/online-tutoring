import { defineConfig } from '@playwright/test';

/**
 * Real-browser layout checks — Phase 13 / 07. LOCAL ONLY, never in CI (no
 * browser downloads there).
 *
 * jsdom does no layout, so it cannot prove a popup is centred or that a CSS
 * change did not move something. These run against the full local stack:
 * emulators + seeded data + `wrangler dev` serving an emulator-mode build.
 * `issues/plan/layout-local.sh` (or the equivalent steps) brings that up;
 * then: LAYOUT_BASE_URL=http://127.0.0.1:8787 npm run test:layout
 */
export default defineConfig({
  testDir: 'tests/layout',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  snapshotPathTemplate: 'tests/layout/__screens__/{arg}{ext}',
  use: {
    baseURL: process.env.LAYOUT_BASE_URL ?? 'http://127.0.0.1:8787',
    browserName: 'chromium',
  },
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 },
  },
});
