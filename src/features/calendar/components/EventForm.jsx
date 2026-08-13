import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { nairobiParts, fromNairobi, formatDayLong, WEEKDAY_LABELS } from '@utils/dates';

/**
 * Event create/edit — Phase 07 D3.
 *
 * The part that matters is the **scope prompt** on a recurring event:
 * *this occurrence* / *this and future* / *all occurrences*.
 *
 * Omitting it is the most common calendar bug there is. Editing next Tuesday
 * without asking silently rewrites every Tuesday that has already happened, and
 * the teacher finds out when last term's timetable has changed under them. So
 * the choice is required, and "this occurrence" is the default — the least
 * destructive option, not the most convenient one.
 */

const COLOURS = ['#667eea', '#f5576c', '#43e97b', '#4facfe', '#fa709a', '#fbbf24'];

function toLocalInput(date) {
  const { year, month, day, hours, minutes } = nairobiParts(date);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function fromLocalInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  return fromNairobi({ year: y, month: mo - 1, day: d, hours: h, minutes: mi });
}

export default function EventForm({
  mode,
  date,
  occurrence,
  saving,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}) {
  const isEdit = mode === 'edit';
  const event = occurrence?.event;
  const isRecurring = Boolean(event?.recurrence);

  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  const initialStart = isEdit ? occurrence.occurrenceStart : (date ?? new Date());
  const initialEnd = isEdit
    ? occurrence.occurrenceEnd
    : new Date(initialStart.getTime() + 60 * 60 * 1000);

  const [form, setForm] = useState({
    title: event?.title ?? '',
    description: event?.description ?? '',
    start: toLocalInput(initialStart),
    end: toLocalInput(initialEnd),
    colour: event?.colour ?? COLOURS[0],
    repeats: isRecurring,
    interval: event?.recurrence?.interval ?? 1,
    byDay: event?.recurrence?.byDay ?? [nairobiParts(initialStart).weekday],
    until: event?.recurrence?.until ? String(event.recurrence.until).slice(0, 10) : '',
  });

  // Default to the least destructive scope.
  const [scope, setScope] = useState('occurrence');
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector('input')?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const start = fromLocalInput(form.start);
    const end = fromLocalInput(form.end);

    if (!form.title.trim()) return setError('Give the event a title.');
    if (!start || !end) return setError('Check the start and end times.');
    if (end < start) return setError('The event cannot end before it starts.');

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      start: start.toISOString(),
      end: end.toISOString(),
      colour: form.colour,
      recurrence: form.repeats
        ? {
            freq: 'weekly',
            interval: Number(form.interval) || 1,
            byDay: form.byDay,
            until: form.until ? new Date(`${form.until}T23:59:59Z`).toISOString() : null,
          }
        : null,
    };

    const result = isEdit
      ? await onUpdate({
          ...payload,
          id: event.id,
          scope: isRecurring ? scope : 'all',
          occurrenceStart: occurrence.occurrenceStart.toISOString(),
        })
      : await onCreate(payload);

    if (result.success) onClose();
  };

  const handleDelete = async () => {
    const result = await onDelete({
      id: event.id,
      scope: isRecurring ? scope : 'all',
      occurrenceStart: occurrence.occurrenceStart.toISOString(),
    });
    if (result.success) onClose();
  };

  return (
    <>
      <div
        className="position-fixed top-0 start-0 w-100 h-100"
        style={{ background: 'rgba(0,0,0,0.4)', zIndex: 1045 }}
        onClick={onClose}
        aria-hidden="true"
      />

      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-form-title"
        className="position-fixed top-50 start-50 translate-middle bg-white rounded shadow-lg p-4"
        style={{ width: 'min(520px, 94vw)', maxHeight: '90vh', overflowY: 'auto', zIndex: 1050 }}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <div className="d-flex justify-content-between align-items-start mb-3">
          <h2 id="event-form-title" className="h5 fw-bold mb-0">
            {isEdit ? 'Edit event' : 'New event'}
          </h2>
          <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
        </div>

        {isEdit && (
          <p className="small text-muted">{formatDayLong(occurrence.occurrenceStart)}</p>
        )}

        {/* THE SCOPE PROMPT. Required before any recurring edit. */}
        {isEdit && isRecurring && (
          <fieldset className="border rounded p-2 mb-3">
            <legend className="float-none w-auto px-2 small fw-semibold">
              This event repeats. Apply changes to:
            </legend>
            {[
              { id: 'occurrence', label: 'Only this occurrence' },
              { id: 'future', label: 'This and all future occurrences' },
              { id: 'all', label: 'Every occurrence, including past ones' },
            ].map((option) => (
              <div className="form-check" key={option.id}>
                <input
                  className="form-check-input"
                  type="radio"
                  name="scope"
                  id={`scope-${option.id}`}
                  checked={scope === option.id}
                  onChange={() => setScope(option.id)}
                />
                <label className="form-check-label small" htmlFor={`scope-${option.id}`}>
                  {option.label}
                </label>
              </div>
            ))}
          </fieldset>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-2">
            <label className="form-label small fw-semibold" htmlFor="event-title">Title</label>
            <input
              id="event-title"
              className="form-control"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={140}
              required
            />
          </div>

          <div className="mb-2">
            <label className="form-label small fw-semibold" htmlFor="event-desc">
              Description <span className="text-muted fw-normal">(optional)</span>
            </label>
            <textarea
              id="event-desc"
              className="form-control"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={2000}
            />
          </div>

          <div className="row g-2 mb-2">
            <div className="col-6">
              <label className="form-label small fw-semibold" htmlFor="event-start">Starts</label>
              <input
                id="event-start"
                type="datetime-local"
                className="form-control"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
                required
              />
            </div>
            <div className="col-6">
              <label className="form-label small fw-semibold" htmlFor="event-end">Ends</label>
              <input
                id="event-end"
                type="datetime-local"
                className="form-control"
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="mb-2">
            <span className="form-label small fw-semibold d-block">Colour</span>
            <div className="d-flex gap-2">
              {COLOURS.map((colour) => (
                <button
                  key={colour}
                  type="button"
                  className="rounded-circle border-0"
                  style={{
                    width: 28,
                    height: 28,
                    background: colour,
                    outline: form.colour === colour ? '3px solid #212529' : 'none',
                    outlineOffset: 2,
                  }}
                  onClick={() => setForm({ ...form, colour })}
                  aria-label={`Colour ${colour}`}
                  aria-pressed={form.colour === colour}
                />
              ))}
            </div>
          </div>

          <div className="form-check mb-2">
            <input
              className="form-check-input"
              type="checkbox"
              id="event-repeats"
              checked={form.repeats}
              onChange={(e) => setForm({ ...form, repeats: e.target.checked })}
            />
            <label className="form-check-label small fw-semibold" htmlFor="event-repeats">
              Repeats weekly
            </label>
          </div>

          {form.repeats && (
            <div className="border rounded p-2 mb-3 bg-light">
              <div className="row g-2 align-items-end">
                <div className="col-5">
                  <label className="form-label small" htmlFor="event-interval">Every</label>
                  <div className="input-group input-group-sm">
                    <input
                      id="event-interval"
                      type="number"
                      min="1"
                      max="12"
                      className="form-control"
                      value={form.interval}
                      onChange={(e) => setForm({ ...form, interval: e.target.value })}
                    />
                    <span className="input-group-text">week(s)</span>
                  </div>
                </div>
                <div className="col-7">
                  <label className="form-label small" htmlFor="event-until">Until (optional)</label>
                  <input
                    id="event-until"
                    type="date"
                    className="form-control form-control-sm"
                    value={form.until}
                    onChange={(e) => setForm({ ...form, until: e.target.value })}
                  />
                </div>
              </div>

              <div className="mt-2">
                <span className="form-label small d-block">On</span>
                <div className="btn-group btn-group-sm flex-wrap" role="group">
                  {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
                    <button
                      key={weekday}
                      type="button"
                      className={`btn ${form.byDay.includes(weekday) ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() =>
                        setForm({
                          ...form,
                          byDay: form.byDay.includes(weekday)
                            ? form.byDay.filter((d) => d !== weekday)
                            : [...form.byDay, weekday],
                        })
                      }
                      aria-pressed={form.byDay.includes(weekday)}
                    >
                      {WEEKDAY_LABELS[weekday]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="alert alert-danger py-2 px-3 small" role="alert">{error}</div>
          )}

          <div className="d-flex justify-content-between gap-2">
            <div className="d-flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <span className="spinner-border spinner-border-sm" /> : 'Save'}
              </button>
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
                Cancel
              </button>
            </div>

            {isEdit && (
              confirmingDelete ? (
                <div className="d-flex gap-1 align-items-center">
                  <span className="small text-muted">
                    {isRecurring && scope === 'all' ? 'Delete every occurrence?' : 'Delete?'}
                  </span>
                  <button type="button" className="btn btn-danger btn-sm" onClick={handleDelete}>
                    Yes
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline-danger"
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete
                </button>
              )
            )}
          </div>
        </form>
      </motion.div>
    </>
  );
}
