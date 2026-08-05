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
 */
export const useCalendar = ({ session, phone, enabled = true } = {}) => {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [events, setEvents] = useState([]);
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showSuccess, showError } = useToast();

  // Avoids re-fetching a window already in flight or already loaded.
  const loadedWindows = useRef(new Set());

  const windowStart = useMemo(() => addDays(startOfMonth(month), -7), [month]);
  const windowEnd = useMemo(() => addDays(endOfMonth(month), 7), [month]);

  const load = useCallback(async () => {
    if (!enabled) return;

    const key = `${windowStart.getTime()}:${windowEnd.getTime()}`;
    if (loadedWindows.current.has(key)) return;

    setLoading(true);
    try {
      const result = await getCalendarEvents({
        from: windowStart.toISOString(),
        to: windowEnd.toISOString(),
        session,
        phone,
      });

      setCalendarEnabled(result.calendarEnabled);
      setEvents(result.events ?? []);
      loadedWindows.current.add(key);
    } catch (error) {
      logger.error('Calendar load failed', error);
      showError(error?.message ?? 'Could not load the calendar.');
    } finally {
      setLoading(false);
    }
  }, [enabled, windowStart, windowEnd, session, phone, showError]);

  useEffect(() => {
    load();
  }, [load]);

  // Expansion is the expensive part; memoise it per (events, window).
  const occurrences = useMemo(
    () => expandAll(events, windowStart, windowEnd),
    [events, windowStart, windowEnd]
  );

  const occurrencesByDay = useMemo(() => groupByDay(occurrences), [occurrences]);

  const refresh = useCallback(() => {
    loadedWindows.current.clear();
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload, successMessage) => {
      setSaving(true);
      try {
        const result = await manageCalendarEvent(payload);
        if (successMessage) showSuccess(successMessage);
        loadedWindows.current.clear();
        await load();
        return { success: true, result };
      } catch (error) {
        logger.error(`Calendar ${payload.action} failed`, error);
        showError(error?.message ?? 'That did not work. Please try again.');
        return { success: false };
      } finally {
        setSaving(false);
      }
    },
    [load, showSuccess, showError]
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
