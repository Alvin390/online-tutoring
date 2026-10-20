import { test, expect } from '@playwright/test';
import { signInTeacher } from './helpers.js';

/**
 * I5 (user issue #5) in a real browser — Phase 13 / 07 D1.
 * The student popup must sit fully inside the viewport and be centred
 * (±2 px) on phones, in landscape, and on desktop.
 */

const PHONES = [
  { name: '360 portrait', width: 360, height: 740 },
  { name: '390 portrait', width: 390, height: 844 },
  { name: '414 portrait', width: 414, height: 896 },
  { name: '740 landscape', width: 740, height: 360 },
];

for (const vp of PHONES) {
  test.describe(`phone ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });

    test('the popup is centred and fully on screen', async ({ page }) => {
      await signInTeacher(page);
      // The real root cause on phones: any horizontal overflow widens the
      // LAYOUT viewport, and fixed overlays centre in that wider box.
      const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(docWidth).toBeLessThanOrEqual(vp.width);
      await page.locator('tr.student-row-wrapper td').nth(1).first().tap();
      const card = page.locator('.student-info-popup');
      await expect(card).toBeVisible();
      await page.waitForTimeout(300); // let the open animation settle
      const box = await card.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
      expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThanOrEqual(2);
      expect(Math.abs(box.y + box.height / 2 - vp.height / 2)).toBeLessThanOrEqual(2);

      // Scrolls inside itself, and the backdrop closes it.
      await page.locator('.student-info-backdrop').click({ position: { x: 4, y: 4 } });
      await expect(card).toBeHidden();
    });
  });
}

test.describe('desktop 1280', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the hover popup is centred and fully on screen', async ({ page }) => {
    await signInTeacher(page);
    await page.locator('tr.student-row-wrapper').first().hover();
    const card = page.locator('.student-info-popup');
    await expect(card).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);
    const box = await card.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(2);
  });
});
