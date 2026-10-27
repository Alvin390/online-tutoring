import { useEffect } from 'react';

export const PAGE_TITLE = 'Online Tutoring Platform';

/**
 * The waiting count in the tab title — 002Fixes / 08: "(4) Online Tutoring
 * Platform", so it shows in a background tab next to Zoom at class time.
 * Restored when the count is 0 and when the dashboard closes.
 */
export function useWaitingTitle(count) {
  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${PAGE_TITLE}` : PAGE_TITLE;
    return () => { document.title = PAGE_TITLE; };
  }, [count]);
}
