/**
 * Which page of the student table this tab was on — 003Fixes / 02.
 *
 * Kept with the key of the search it belongs to: a page number only means
 * something for the same session, search, filters and sort, so a different
 * key starts again at page 1.
 */
export const PAGE_SIZE = 20;
// Also removed at sign-out by searchStorage.js (the key holds the search text).
export const STUDENT_PAGE_STORAGE_KEY = 'dashboard.studentPage.v1';

export function readStoredPage(key) {
  if (!key) return { key, page: 0 };
  try {
    const saved = JSON.parse(sessionStorage.getItem(STUDENT_PAGE_STORAGE_KEY) ?? 'null');
    if (saved?.key === key && Number.isInteger(saved.page) && saved.page >= 0) return saved;
  } catch { /* storage unavailable or malformed */ }
  return { key, page: 0 };
}

export function writeStoredPage(key, page) {
  if (!key) return;
  try {
    sessionStorage.setItem(STUDENT_PAGE_STORAGE_KEY, JSON.stringify({ key, page }));
  } catch { /* storage unavailable */ }
}
