/**
 * Shared steps for the local layout checks. Accounts come from
 * scripts/perf/seedLocal.mjs (teacher) and the layout runner (superadmin) —
 * emulator users only; these never touch production.
 */

export const TEACHER = { email: 'teacher@perf.local', password: 'perf-pass-123' };
export const SUPERADMIN = { email: 'super@perf.local', password: 'perf-super-pass-123' };

export async function signInTeacher(page) {
  await page.goto('/login');
  await page.getByPlaceholder('teacher@school.com').fill(TEACHER.email);
  await page.locator('input[type="password"]').fill(TEACHER.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await page.locator('tr.student-row-wrapper').first().waitFor({ timeout: 30_000 });
}

export async function signInSuperadmin(page) {
  await page.goto('/superadmin');
  await page.locator('#sa-email').fill(SUPERADMIN.email);
  await page.locator('#sa-password').fill(SUPERADMIN.password);
  await page.locator('button[type="submit"]').click();
  await page.getByRole('tab', { name: /Accounts & tiers/ }).waitFor({ timeout: 30_000 });
}
