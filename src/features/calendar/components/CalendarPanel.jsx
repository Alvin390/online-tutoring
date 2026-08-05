import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import MonthGrid from './MonthGrid';
import AgendaList from './AgendaList';
import EventForm from './EventForm';
import { useCalendar } from '../hooks/useCalendar';
import { formatMonthYear, startOfDay } from '@utils/dates';

/**
 * Calendar — Phase 07 D3.
 *
 * Month grid and agenda, sharing one data hook. The whole panel is lazily
 * loaded by the dashboard, so it never enters the initial chunk.
 *
 * `aria-live` announces the month on navigation, because otherwise a screen
 * reader user pressing "next" gets no feedback that anything changed — the
 * grid contents update silently.
 */
export default function CalendarPanel({ readOnly = false, session, phone }) {
  const {
    month,
    goToPreviousMonth,
    goToNextMonth,
    goToToday,
    occurrences,
    occurrencesByDay,
    calendarEnabled,
    loading,
    saving,
    createEvent,
    updateEvent,
    deleteEvent,
  } = useCalendar({ session, phone });

  const [view, setView] = useState(readOnly ? 'agenda' : 'month');
  const [focusedDate, setFocusedDate] = useState(() => startOfDay(new Date()));
  const [editing, setEditing] = useState(null);

  const handleSelectDay = useCallback(
    (date) => {
      if (readOnly) return;
      setEditing({ mode: 'create', date });
    },
    [readOnly]
  );

  const handleSelectOccurrence = useCallback(
    (occurrence) => {
      if (readOnly) return;
      setEditing({ mode: 'edit', occurrence });
    },
    [readOnly]
  );

  if (!calendarEnabled && !loading) {
    return (
      <div className="card mb-4">
        <div className="card-body text-center py-4">
          <p className="text-muted mb-0">The calendar is not switched on yet.</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card mb-4">
      <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h5 className="mb-0">
          <i className="bi bi-calendar3 me-2" aria-hidden="true" />
          Calendar
        </h5>

        <div className="d-flex align-items-center gap-2 flex-wrap">
          <div className="btn-group btn-group-sm" role="group" aria-label="Calendar view">
            <button
              className={`btn ${view === 'month' ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setView('month')}
              aria-pressed={view === 'month'}
            >
              Month
            </button>
            <button
              className={`btn ${view === 'agenda' ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setView('agenda')}
              aria-pressed={view === 'agenda'}
            >
              Agenda
            </button>
          </div>

          {!readOnly && (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => setEditing({ mode: 'create', date: focusedDate })}
              disabled={saving}
            >
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              New event
            </button>
          )}
        </div>
      </div>

      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            className="btn btn-outline-secondary btn-sm"
            onClick={goToPreviousMonth}
            aria-label="Previous month"
          >
            <i className="bi bi-chevron-left" aria-hidden="true" />
          </button>

          {/* Announced on navigation — otherwise the grid changes silently. */}
          <h3 className="h6 fw-bold mb-0" aria-live="polite">
            {formatMonthYear(month)}
          </h3>

          <div className="d-flex gap-1">
            <button className="btn btn-outline-secondary btn-sm" onClick={goToToday}>
              Today
            </button>
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={goToNextMonth}
              aria-label="Next month"
            >
              <i className="bi bi-chevron-right" aria-hidden="true" />
            </button>
          </div>
        </div>

        {loading && (
          <div className="text-center py-4">
            <span className="spinner-border spinner-border-sm text-muted" />
          </div>
        )}

        {!loading && view === 'month' && (
          <div className="table-responsive">
            <MonthGrid
              month={month}
              occurrencesByDay={occurrencesByDay}
              focusedDate={focusedDate}
              onFocusDate={setFocusedDate}
              onSelectDay={handleSelectDay}
              onSelectOccurrence={handleSelectOccurrence}
            />
            <p className="small text-muted mt-2 mb-0">
              Use the arrow keys to move between days, Page Up and Page Down to change
              month, and Enter to add an event.
            </p>
          </div>
        )}

        {!loading && view === 'agenda' && (
          <AgendaList
            occurrences={occurrences}
            onSelectOccurrence={handleSelectOccurrence}
            emptyMessage={
              readOnly
                ? 'Events your teacher adds will appear here.'
                : 'Click a day in the month view to add your first event.'
            }
          />
        )}
      </div>

      {editing && !readOnly && (
        <EventForm
          mode={editing.mode}
          date={editing.date}
          occurrence={editing.occurrence}
          saving={saving}
          onCreate={createEvent}
          onUpdate={updateEvent}
          onDelete={deleteEvent}
          onClose={() => setEditing(null)}
        />
      )}
    </motion.div>
  );
}
