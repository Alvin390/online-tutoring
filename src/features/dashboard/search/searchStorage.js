/**
 * The saved student search's storage key and its removal — 001Fixes / 04.
 * Its own tiny module because AuthContext (in the login shell) needs only
 * this, at sign-out, and should not carry the rest of the search state code.
 */
export const STUDENT_SEARCH_STORAGE_KEY = 'dashboard.studentSearch.v1';

export function clearStoredSearch() {
  try {
    sessionStorage.removeItem(STUDENT_SEARCH_STORAGE_KEY);
  } catch { /* storage unavailable */ }
}
