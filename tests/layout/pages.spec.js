import { test, expect } from '@playwright/test';
import { signInTeacher, signInSuperadmin } from './helpers.js';

/**
 * Before/after screenshots for the global CSS reset review — Phase 13 / 07 D5.
 *
 * Run once with `--update-snapshots` on the current CSS to record the
 * baseline, make the CSS change, run again: any pixel that moved fails, with
 * a diff image in test-results/ to judge whether it is a regression.
 */

const WIDTHS = [360, 768, 1280];

// Not 'networkidle': Firestore keeps a listen channel open, so it never comes.
async function settle(page) {
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(1500);
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('public pages', async ({ page }) => {
      for (const [name, path] of [['home', '/'], ['morning', '/morning'], ['login', '/login']]) {
        await page.goto(path);
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}-${width}.png`, { fullPage: true });
      }
    });

    test('teacher pages', async ({ page }) => {
      await signInTeacher(page);
      await settle(page);
      // Viewport only: 500 seeded rows animate in with a 0.05 s stagger (~25 s),
      // so a full-page capture never stabilises. The top of the dashboard —
      // header, stats, tabs, first rows — is what a reset change would move.
      await page.waitForTimeout(2500);
      await expect(page).toHaveScreenshot(`dashboard-${width}.png`, { timeout: 20_000 });
      await page.goto('/billing');
      await settle(page);
      await expect(page).toHaveScreenshot(`billing-${width}.png`, { fullPage: true });
    });

    test('superadmin', async ({ page }) => {
      await signInSuperadmin(page);
      await settle(page);
      await expect(page).toHaveScreenshot(`superadmin-${width}.png`, { fullPage: true });
    });
  });
}

// Overlays and lower panels the page captures above do not reach.
for (const width of [360, 1280]) {
  test.describe(`${width}px components`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('drawer, calendar and Help & feedback', async ({ page }) => {
      await signInTeacher(page);
      await settle(page);
      const calendar = page.locator('.calendar-grid').first();
      await calendar.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await expect(calendar).toHaveScreenshot(`calendar-${width}.png`, { timeout: 20_000 });

      await page.locator('button[aria-label^="Open details and notes for"]').first().click();
      const drawer = page.getByRole('dialog').first();
      await drawer.waitFor();
      await page.waitForTimeout(2000);
      await expect(drawer).toHaveScreenshot(`drawer-${width}.png`, { timeout: 20_000 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      await page.getByRole('button', { name: /Help & feedback/ }).first().click();
      const help = page.getByRole('dialog', { name: 'Help & feedback' });
      await help.waitFor();
      // "Your reports" loads after opening and changes the dialog's height.
      await help.getByText(/Nothing sent yet|BUG-|FR-/).first().waitFor();
      await page.waitForTimeout(2000); // framer's open animation, fully settled
      // At 360 px this capture flips between two sub-pixel renderings (an
      // identical 2,324-pixel line shift, run to run, with no code change).
      // Tolerate exactly that noise; a real spacing change is far larger, and
      // the diff is inspected by eye during the reset review anyway.
      await expect(help).toHaveScreenshot(`help-${width}.png`, { timeout: 20_000, maxDiffPixels: 2400 });
    });

    test('superadmin inboxes and settings', async ({ page }) => {
      await signInSuperadmin(page);
      for (const [tab, name] of [[/Bug reports/, 'bugs'], [/Settings/, 'settings']]) {
        await page.getByRole('tab', { name: tab }).click();
        await page.waitForTimeout(1500);
        await expect(page).toHaveScreenshot(`superadmin-${name}-${width}.png`, { fullPage: true, timeout: 20_000 });
      }
    });
  });
}
