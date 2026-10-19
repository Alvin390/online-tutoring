import { test, expect } from '@playwright/test';
import { signInTeacher } from './helpers.js';

/**
 * Dashboard row virtualisation in a real browser — Phase 13 / 08 B2.
 * The seeded Morning session has 167 students (above the 50-row threshold).
 */

for (const width of [1280, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('renders only the rows near the viewport, and they follow the scroll', async ({ page }) => {
      await signInTeacher(page);
      await page.waitForTimeout(2500);
      const top = await page.evaluate(() => Math.round(
        document.querySelector('tr.student-row-wrapper').closest('tbody').getBoundingClientRect().top + window.scrollY
      ));
      // Median rendered row height (the first row can differ, e.g. a badge).
      const rowH = await page.evaluate(() => {
        const h = [...document.querySelectorAll('tr.student-row-wrapper')].map((el) => el.getBoundingClientRect().height).sort((a, b) => a - b);
        return h[Math.floor(h.length / 2)];
      });
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(top + rowH * 50));
      await page.waitForTimeout(800);
      const r = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('tr.student-row-wrapper')];
        const visible = rows
          .filter((el) => { const b = el.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; })
          .map((el) => Number(el.getAttribute('data-index')));
        return { inDom: rows.length, visible };
      });
      expect(r.inDom).toBeLessThanOrEqual(40);
      expect(Math.min(...r.visible)).toBeGreaterThanOrEqual(45);
      expect(Math.min(...r.visible)).toBeLessThanOrEqual(55);
    });

    test('the last student is reachable at the bottom of the page', async ({ page }) => {
      await signInTeacher(page);
      await page.waitForTimeout(2500);
      const total = await page.evaluate(() => Number(/\((\d+)\)/.exec(document.querySelector('.dashboard-session-tabs .nav-link.active').textContent)[1]));
      for (let i = 0; i < 4; i += 1) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(500);
      }
      const last = await page.evaluate(() => Math.max(...[...document.querySelectorAll('tr.student-row-wrapper')].map((el) => Number(el.getAttribute('data-index')))));
      expect(last).toBe(total - 1);
    });
  });
}
