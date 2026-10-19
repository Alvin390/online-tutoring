/**
 * Intent-based prefetch — Phase 13 / 08 A5.
 *
 * The staff side (Auth, Firestore, the login page) is not part of a public
 * page's bundle. When someone shows intent to go there — hovering, focusing or
 * touching the "Teacher Dashboard" link — start downloading it, so the login
 * screen is ready by the time the click lands. Once per page load.
 */
let started = false;

export function prefetchStaff() {
  if (started) return;
  started = true;
  // Fire-and-forget; a failed prefetch simply means the click loads it.
  Promise.all([import('./StaffShell'), import('@/pages/LoginPage')]).catch(() => {
    started = false;
  });
}
