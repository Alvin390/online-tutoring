import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getCalendarEvents, manageCalendarEvent } from '@services/api/calendar';
import { expandAll, groupByDay } from '@utils/recurrence';
import { startOfMonth, endOfMonth, addMonths, addDays } from '@utils/dates';
import { useToast } from '@/context/ToastContext';
import logger from '@utils/logger';

/**
 * Calendar data — Phase 07 D7.
 *
 * Fetches a window a little wider than the visible month, because a weekly
 * series starting late in the previous month produces occurrences in the first
 * row of this one. Fetching exactly the month would leave visible gaps in the
 * leading and trailing grid cells.
 *
 * Recurrence expansion is memoised on (events, window), so paging back to a
 * month already loaded is instant and does not re-expand every rule.
 *
 * S-cal-stale (Phase 13 / 07 D3): results are cached PER WINDOW. There used
 * to be one `events` array plus a set of "already loaded" windows, so paging
 * Oct → Nov → Oct skipped the refetch and kept showing November's events in
 * October. Now the visible window always reads its own cache entry; going back
 * renders from the cache with no request. Any mutation clears the cache.
 * (Phase 08 moves this onto TanStack Query.)
 */
export const useCalendar = ({ session, phone, enabled = true } = {}) => {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  // windowKey -> events. State (not a ref) so a late response re-renders.
  const [cache, setCache] = useState(() => new Map());
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showSuccess, showError } = useToast();

  // Windows with a request in flight, so a double render does not refetch.
  const inFlight = useRef(new Set());
  // Bumped by a mutation, so a response that raced it is not cached.
  const generation = useRef(0);

  const windowStart = useMemo(() => addDays(startOfMonth(month), -7), [month]);
  const windowEnd = useMemo(() => addDays(endOfMonth(month), 7), [month]);
  const windowKey = `${session ?? ''}|${phone ?? ''}|${windowStart.getTime()}:${windowEnd.getTime()}`;
  const events = useMemo(() => cache.get(windowKey) ?? [], [cache, windowKey]);

  const load = useCallback(async ({ force = false } = {}) => {
    if (!enabled) return;

    const key = windowKey;
    if (!force && (cache.has(key) || inFlight.current.has(key))) return;
    inFlight.current.add(key);
    const gen = generation.current;

    setLoading(true);
    try {
      const result = await getCalendarEvents({
        from: windowStart.toISOString(),
        to: windowEnd.toISOString(),
        session,
        phone,
      });

      setCalendarEnabled(result.calendarEnabled);
      if (gen === generation.current) {
        setCache((prev) => new Map(prev).set(key, result.events ?? []));
      }
    } catch (error) {
      logger.error('Calendar load failed', error);
      showError(error?.message ?? 'Could not load the calendar.');
    } finally {
      inFlight.current.delete(key);
      setLoading(false);
    }
  }, [enabled, windowKey, cache, windowStart, windowEnd, session, phone, showError]);

  useEffect(() => {
    load();
  }, [load]);

  // Expansion is the expensive part; memoise it per (events, window).
  const occurrences = useMemo(
    () => expandAll(events, windowStart, windowEnd),
    [events, windowStart, windowEnd]
  );

  const occurrencesByDay = useMemo(() => groupByDay(occurrences), [occurrences]);

  const invalidate = useCallback(() => {
    generation.current += 1;
    inFlight.current.clear();
    setCache(new Map());
  }, []);

  const refresh = useCallback(() => {
    invalidate();
    load({ force: true });
  }, [invalidate, load]);

  const mutate = useCallback(
    async (payload, successMessage) => {
      setSaving(true);
      try {
        const result = await manageCalendarEvent(payload);
        if (successMessage) showSuccess(successMessage);
        invalidate();
        await load({ force: true });
        return { success: true, result };
      } catch (error) {
        logger.error(`Calendar ${payload.action} failed`, error);
        showError(error?.message ?? 'That did not work. Please try again.');
        return { success: false };
      } finally {
        setSaving(false);
      }
    },
    [invalidate, load, showSuccess, showError]
  );

  return {
    month,
    setMonth,
    goToPreviousMonth: () => setMonth((m) => addMonths(m, -1)),
    goToNextMonth: () => setMonth((m) => addMonths(m, 1)),
    goToToday: () => setMonth(startOfMonth(new Date())),

    events,
    occurrences,
    occurrencesByDay,
    calendarEnabled,
    loading,
    saving,
    refresh,

    createEvent: (data) => mutate({ action: 'create', ...data }, 'Event added to the calendar.'),
    updateEvent: (data) => mutate({ action: 'update', ...data }, 'Event updated.'),
    deleteEvent: (data) => mutate({ action: 'delete', ...data }, 'Event removed.'),
  };
};
