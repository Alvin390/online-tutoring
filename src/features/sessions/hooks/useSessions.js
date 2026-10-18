import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@services/firebase/config';
import { manageSession } from '@services/api/sessions';
import { useToast } from '@/context/ToastContext';
import logger from '@utils/logger';

/**
 * Session list — Phase 05 Part A.
 *
 * A realtime listener rather than a one-shot fetch, despite the plan's
 * suggestion to cache with `staleTime: Infinity`. The reason is concrete: the
 * dashboard creates one student listener PER ACTIVE SESSION, so it has to know
 * immediately when a session is created, deactivated or deleted. A stale list
 * means either a listener on a session that no longer exists (a permission
 * error) or a missing listener on one that does (silently absent students).
 *
 * The collection is a handful of small documents; this is not the expensive
 * listener on the page.
 *
 * `bootstrap` (Phase 13 / 02 D1): when the dashboard sees an EMPTY session list,
 * it asks the server to create the default morning and evening sessions —
 * once per mount, silently. The server side is run-once and idempotent, so a
 * second tab or a deliberately emptied list is harmless: once bootstrapped, a
 * deployment is never re-seeded.
 *
 * @param {{ bootstrap?: boolean }} [options]
 */
export const useSessions = ({ bootstrap = false } = {}) => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { showSuccess, showError } = useToast();
  const bootstrapAttempted = useRef(false);

  useEffect(() => {
    const q = query(collection(db, 'sessions'), orderBy('order', 'asc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = [];
        snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
        setSessions(list);
        setLoading(false);
      },
      (error) => {
        logger.error('Sessions listener failed', error);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!bootstrap || loading || sessions.length > 0 || bootstrapAttempted.current) return;
    bootstrapAttempted.current = true;
    manageSession({ action: 'bootstrap' }).catch((error) => {
      // Not surfaced: the hourly sweep bootstraps too, and the dashboard
      // already falls back to the two original sessions meanwhile.
      logger.warn('Session bootstrap request failed', { code: error?.code });
    });
  }, [bootstrap, loading, sessions.length]);

  const run = useCallback(
    async (payload, successMessage) => {
      setBusy(true);
      try {
        const result = await manageSession(payload);
        if (successMessage) showSuccess(successMessage);
        return { success: true, result };
      } catch (error) {
        logger.error(`Session ${payload.action} failed`, error);
        showError(error?.message ?? 'That did not work. Please try again.');
        return { success: false, message: error?.message, code: error?.code };
      } finally {
        setBusy(false);
      }
    },
    [showSuccess, showError]
  );

  const createSession = useCallback(
    (data) => run({ action: 'create', ...data }, `"${data.name}" created.`),
    [run]
  );

  const updateSession = useCallback(
    (slug, data) => run({ action: 'update', slug, ...data }, 'Session updated.'),
    [run]
  );

  const setSessionLink = useCallback(
    (slug, url) => run({ action: 'setLink', slug, url }, 'Class link updated.'),
    [run]
  );

  const reorderSessions = useCallback((order) => run({ action: 'reorder', order }), [run]);

  const deleteSession = useCallback(
    (slug, confirmName, reassignTo) =>
      run(
        { action: 'delete', slug, confirmName, reassignTo: reassignTo ?? null },
        'Session deleted.'
      ),
    [run]
  );

  const toggleActive = useCallback(
    (session) =>
      run(
        { action: 'update', slug: session.id, active: !session.active },
        session.active ? `"${session.name}" hidden from students.` : `"${session.name}" is live.`
      ),
    [run]
  );

  return {
    sessions,
    activeSessions: sessions.filter((s) => s.active !== false),
    loading,
    busy,
    createSession,
    updateSession,
    setSessionLink,
    reorderSessions,
    deleteSession,
    toggleActive,
  };
};
