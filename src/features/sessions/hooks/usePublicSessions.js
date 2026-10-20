import { useEffect, useState } from 'react';
import { getPublicBootstrap } from '@services/api/public';
import { FALLBACK_SESSIONS } from '@shared/constants/sessions';
import logger from '@utils/logger';

/**
 * Active sessions for the public homepage — Phase 13 / 02 D5.
 *
 * A ONE-SHOT read, not a listener: a visitor choosing a class does not need
 * live updates, and the sessions collection is world-readable by design.
 * Sorted client-side by `order` so the query needs no composite index.
 *
 * Falls back to morning + evening when the read fails or returns nothing, so
 * the homepage never shows "no classes" because of a network error — or on a
 * deployment that has not bootstrapped its sessions yet (production today).
 * The empty-list fallback is TRANSITIONAL and goes with the matching server and
 * rules clauses in Phase 13 / 09.
 *
 * Phase 13 / 08 A1: the data comes from /api/public/bootstrap (sorted and
 * filtered to active sessions by the server) — no Firestore SDK on this page.
 * The component only depends on this hook's return shape.
 *
 * @returns {{ sessions: object[], loading: boolean, fallback: boolean }}
 */
export function usePublicSessions() {
  const [state, setState] = useState({ sessions: [], loading: true, fallback: false });

  useEffect(() => {
    let cancelled = false;

    getPublicBootstrap()
      .then((data) => {
        if (cancelled) return;
        const list = (data?.sessions ?? []).map((s) => ({ id: s.slug, ...s }));
        setState(
          list.length > 0
            ? { sessions: list, loading: false, fallback: false }
            : { sessions: FALLBACK_SESSIONS, loading: false, fallback: true }
        );
      })
      .catch((error) => {
        if (cancelled) return;
        logger.warn('Public session list unavailable; using defaults', { code: error?.code });
        setState({ sessions: FALLBACK_SESSIONS, loading: false, fallback: true });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export default usePublicSessions;
