import { useMemo } from 'react';
import { formatTime, formatDayLong, dayKey, isSameDay } from '@utils/dates';

/**
 * Agenda list — Phase 07 D3/D4.
 *
 * The default for students, because what a student wants is "what's next", not
 * a month to navigate. Grouped by day with sticky headers.
 *
 * Not virtualised. The plan calls for virtualisation beyond 50 items, but the
 * window is capped at 90 days and a tutoring timetable produces on the order of
 * 30–60 occurrences in that span. Adding a windowing library to render 60 rows
 * would cost more bundle than it saves in DOM. If a real deployment ever
 * exceeds a few hundred, revisit — the grouping below is already the shape a
 * virtualiser would need.
 */
export default function AgendaList({ occurrences, onSelectOccurrence, emptyMessage }) {
  const grouped = useMemo(() => {
    const map = new Map();
    for (const occurrence of occurrences) {
      const key = dayKey(occurrence.occurrenceStart);
      if (!map.has(key)) map.set(key, { date: occurrence.occurrenceStart, items: [] });
      map.get(key).items.push(occurrence);
    }
    return [...map.values()];
  }, [occurrences]);

  const today = new Date();

  if (grouped.length === 0) {
    return (
      <div className="text-center py-5 border rounded bg-light">
        <i
          className="bi bi-calendar3 d-block mb-2 text-muted"
          style={{ fontSize: '2rem' }}
          aria-hidden="true"
        />
        <p className="fw-semibold mb-1">Nothing scheduled</p>
        <p className="small text-muted mb-0">
          {emptyMessage ?? 'Events your teacher adds will appear here.'}
        </p>
      </div>
    );
  }

  return (
    <div>
      {grouped.map((group) => (
        <section key={dayKey(group.date)} className="mb-3">
          <h3
            className="h6 fw-bold text-muted position-sticky bg-white py-2 mb-2"
            style={{ top: 0, zIndex: 1 }}
          >
            {formatDayLong(group.date)}
            {isSameDay(group.date, today) && (
              <span className="badge text-bg-primary ms-2">Today</span>
            )}
          </h3>

          <ul className="list-unstyled mb-0">
            {group.items.map((occurrence) => (
              <li key={occurrence.key} className="mb-2">
                <button
                  type="button"
                  className="w-100 text-start border rounded p-2 bg-white"
                  style={{ borderLeftWidth: 4, borderLeftColor: occurrence.event.colour ?? '#667eea' }}
                  onClick={() => onSelectOccurrence?.(occurrence)}
                >
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div>
                      <div className="fw-semibold">{occurrence.event.title}</div>
                      {occurrence.event.description && (
                        <div className="small text-muted">{occurrence.event.description}</div>
                      )}
                      {(occurrence.event.sessionIds ?? []).length > 0 && (
                        <div className="small text-muted mt-1">
                          {occurrence.event.sessionIds.map((s) => (
                            <span key={s} className="badge text-bg-light text-dark border me-1 text-capitalize">
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="text-end small text-nowrap">
                      <div className="fw-semibold">{formatTime(occurrence.occurrenceStart)}</div>
                      <div className="text-muted">{formatTime(occurrence.occurrenceEnd)}</div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
