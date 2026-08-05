import { useRef, useCallback, useMemo } from 'react';
import {
  monthGrid,
  nairobiParts,
  dayKey,
  formatDayLong,
  formatTime,
  addDays,
  addMonths,
  isSameDay,
  WEEKDAY_LABELS,
  WEEKDAY_FULL,
} from '@utils/dates';

/**
 * Month grid — Phase 07 D2/D6.
 *
 * A real `<table>`, not a div soup. Calendars are among the easiest components
 * to make unusable with a keyboard, so the accessibility here is specified
 * rather than hoped for:
 *
 *   - `<th scope="col">` day headers, so a screen reader announces the column
 *   - ONE tab stop for the whole grid (roving tabindex); arrows move within it.
 *     42 tab stops would make reaching the content below the calendar a chore.
 *   - Arrows move by day, PageUp/PageDown by month, Home/End to week bounds
 *   - Each cell announces its date and event count: "12 March, 2 events"
 *   - Colour is never the only carrier of meaning — every event chip has its
 *     title as text, and today is marked with a bold ring plus a visually
 *     hidden "today" label rather than only a background colour
 */

export default function MonthGrid({
  month,
  occurrencesByDay,
  focusedDate,
  onFocusDate,
  onSelectDay,
  onSelectOccurrence,
}) {
  const gridRef = useRef(null);
  const cells = useMemo(() => monthGrid(month), [month]);
  const today = useMemo(() => new Date(), []);

  const move = useCallback(
    (days) => {
      const next = addDays(focusedDate, days);
      onFocusDate(next);
      // Focus follows the roving tabindex to the newly active cell.
      requestAnimationFrame(() => {
        gridRef.current
          ?.querySelector(`[data-daykey="${dayKey(next)}"]`)
          ?.focus();
      });
    },
    [focusedDate, onFocusDate]
  );

  const handleKeyDown = useCallback(
    (event) => {
      const { key } = event;
      const parts = nairobiParts(focusedDate);

      switch (key) {
        case 'ArrowRight': event.preventDefault(); move(1); break;
        case 'ArrowLeft': event.preventDefault(); move(-1); break;
        case 'ArrowDown': event.preventDefault(); move(7); break;
        case 'ArrowUp': event.preventDefault(); move(-7); break;
        case 'Home': {
          event.preventDefault();
          // Monday of the focused week.
          move(-((parts.weekday + 6) % 7));
          break;
        }
        case 'End': {
          event.preventDefault();
          move(6 - ((parts.weekday + 6) % 7));
          break;
        }
        case 'PageUp': {
          event.preventDefault();
          onFocusDate(addMonths(focusedDate, -1));
          break;
        }
        case 'PageDown': {
          event.preventDefault();
          onFocusDate(addMonths(focusedDate, 1));
          break;
        }
        case 'Enter':
        case ' ': {
          event.preventDefault();
          onSelectDay(focusedDate);
          break;
        }
        default:
          break;
      }
    },
    [focusedDate, move, onFocusDate, onSelectDay]
  );

  return (
    <table
      className="table table-bordered mb-0 calendar-grid"
      ref={gridRef}
      role="grid"
      aria-label="Month view"
    >
      <thead>
        <tr>
          {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
            <th key={weekday} scope="col" className="text-center small text-muted fw-normal">
              <span aria-hidden="true">{WEEKDAY_LABELS[weekday]}</span>
              <span className="visually-hidden">{WEEKDAY_FULL[weekday]}</span>
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {Array.from({ length: 6 }, (_, week) => (
          <tr key={week}>
            {cells.slice(week * 7, week * 7 + 7).map((cell) => {
              const dayOccurrences = occurrencesByDay.get(cell.key) ?? [];
              const isFocused = isSameDay(cell.date, focusedDate);
              const isToday = isSameDay(cell.date, today);
              const { day } = nairobiParts(cell.date);

              return (
                <td
                  key={cell.key}
                  data-daykey={cell.key}
                  role="gridcell"
                  // Roving tabindex: exactly one cell is tabbable at a time.
                  tabIndex={isFocused ? 0 : -1}
                  onKeyDown={handleKeyDown}
                  onFocus={() => onFocusDate(cell.date)}
                  onClick={() => onSelectDay(cell.date)}
                  aria-selected={isFocused}
                  aria-label={`${formatDayLong(cell.date)}, ${
                    dayOccurrences.length === 0
                      ? 'no events'
                      : `${dayOccurrences.length} event${dayOccurrences.length === 1 ? '' : 's'}`
                  }`}
                  className={[
                    'align-top p-1',
                    cell.inMonth ? '' : 'bg-light text-muted',
                    isFocused ? 'border-primary border-2' : '',
                  ].join(' ')}
                  style={{ height: 96, cursor: 'pointer', verticalAlign: 'top' }}
                >
                  <div className="d-flex justify-content-between align-items-start">
                    <span
                      className={`small ${isToday ? 'fw-bold text-primary' : ''}`}
                      aria-hidden="true"
                    >
                      {day}
                    </span>
                    {isToday && <span className="visually-hidden">Today</span>}
                    {isToday && (
                      <span
                        className="badge rounded-pill bg-primary"
                        style={{ width: 8, height: 8, padding: 0 }}
                        aria-hidden="true"
                      />
                    )}
                  </div>

                  <div className="d-flex flex-column gap-1 mt-1">
                    {dayOccurrences.slice(0, 3).map((occurrence) => (
                      <button
                        key={occurrence.key}
                        type="button"
                        className="btn btn-sm text-start p-0 px-1 text-truncate border-0"
                        style={{
                          background: `${occurrence.event.colour ?? '#667eea'}22`,
                          borderLeft: `3px solid ${occurrence.event.colour ?? '#667eea'}`,
                          fontSize: '0.7rem',
                          lineHeight: 1.4,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectOccurrence(occurrence);
                        }}
                        // Title as text, never colour alone.
                        title={`${formatTime(occurrence.occurrenceStart)} ${occurrence.event.title}`}
                        tabIndex={-1}
                      >
                        {formatTime(occurrence.occurrenceStart)} {occurrence.event.title}
                      </button>
                    ))}

                    {dayOccurrences.length > 3 && (
                      <span className="small text-muted px-1" style={{ fontSize: '0.7rem' }}>
                        +{dayOccurrences.length - 3} more
                      </span>
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
