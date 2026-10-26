import { memo, useId, useState } from 'react';
import { STATUS_KEYS, STATUS_LABELS, SORTS } from '../search/studentSearch';

const SORT_LABELS = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name A–Z',
  'name-desc': 'Name Z–A',
  class: 'Class',
  balance: 'Balance owed',
};

/**
 * Status, subject, date and sort filters — 001Fixes / 05.
 *
 * Wider screens show them inline under the class chips. On a phone they fold
 * behind a "Filters (n)" button (n = how many of them are on), so the search
 * box, class chips and results stay in view; closing the panel keeps every
 * choice. Statuses and subjects show live counts and are greyed at 0.
 */
function StudentFilters({
  state,
  statusCounts,
  subjectOptions,
  subjectCounts,
  onToggleStatus,
  onToggleSubject,
  onRange,
  onSort,
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [subjectsOpen, setSubjectsOpen] = useState(false);

  const chosenSubjects = new Set(state.subjects.map((s) => s.toLowerCase()));
  const extraCount = state.statuses.length + state.subjects.length
    + (state.from ? 1 : 0) + (state.to ? 1 : 0) + (state.sort !== 'newest' ? 1 : 0);

  return (
    <div className="more-filters-wrap">
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary more-filters-toggle d-sm-none"
        aria-expanded={open}
        aria-controls={`${id}-more`}
        onClick={() => setOpen((v) => !v)}
      >
        <i className="bi bi-sliders me-1" aria-hidden="true" />
        Filters
        {extraCount > 0 && <span className="badge rounded-pill text-bg-primary ms-1">{extraCount}</span>}
      </button>

      <div id={`${id}-more`} className={`more-filters ${open ? 'is-open' : ''}`}>
        <div className="filter-chip-row" role="group" aria-label="Filter by status">
          <span className="filter-chip-label small fw-semibold text-muted">Status</span>
          <div className="filter-chips">
            {STATUS_KEYS.map((key) => {
              const pressed = state.statuses.includes(key);
              const count = statusCounts[key] ?? 0;
              return (
                <button
                  key={key}
                  type="button"
                  className={`btn btn-sm filter-chip ${pressed ? 'is-active' : ''} ${count === 0 && !pressed ? 'is-empty' : ''}`}
                  aria-pressed={pressed}
                  onClick={() => onToggleStatus(key)}
                >
                  {STATUS_LABELS[key]}
                  {' '}
                  <span className="filter-chip-count">{count}</span>
                  <span className="visually-hidden"> students</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="more-filters-row">
          <div className="more-filters-field">
            <button
              type="button"
              className={`btn btn-sm btn-outline-secondary subject-filter-toggle ${state.subjects.length ? 'is-active' : ''}`}
              aria-expanded={subjectsOpen}
              aria-controls={`${id}-subjects`}
              onClick={() => setSubjectsOpen((v) => !v)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSubjectsOpen(false); }}
            >
              <i className="bi bi-journal-text me-1" aria-hidden="true" />
              Subject
              {state.subjects.length > 0 && <span className="badge rounded-pill text-bg-primary ms-1">{state.subjects.length}</span>}
              <i className={`bi bi-chevron-${subjectsOpen ? 'up' : 'down'} ms-1`} aria-hidden="true" />
            </button>
          </div>

          <label className="more-filters-field small">
            <span className="text-muted d-block">From</span>
            <input
              type="date"
              className="form-control form-control-sm"
              value={state.from ?? ''}
              max={state.to ?? undefined}
              onChange={(e) => onRange(e.target.value || null, state.to)}
              aria-label="Registered from"
            />
          </label>
          <label className="more-filters-field small">
            <span className="text-muted d-block">To</span>
            <input
              type="date"
              className="form-control form-control-sm"
              value={state.to ?? ''}
              min={state.from ?? undefined}
              onChange={(e) => onRange(state.from, e.target.value || null)}
              aria-label="Registered to"
            />
          </label>
          <label className="more-filters-field small">
            <span className="text-muted d-block">Sort</span>
            <select
              className="form-select form-select-sm"
              value={state.sort}
              onChange={(e) => onSort(e.target.value)}
              aria-label="Sort students"
            >
              {SORTS.map((sort) => <option key={sort} value={sort}>{SORT_LABELS[sort]}</option>)}
            </select>
          </label>
        </div>

        {subjectsOpen && (
          <div
            id={`${id}-subjects`}
            className="subject-filter-list border rounded p-2"
            role="group"
            aria-label="Filter by subject"
            onKeyDown={(e) => { if (e.key === 'Escape') setSubjectsOpen(false); }}
          >
            {subjectOptions.length === 0 && <div className="small text-muted">No subjects recorded yet.</div>}
            {subjectOptions.map((option) => {
              const checked = chosenSubjects.has(option.label.toLowerCase());
              const count = subjectCounts[option.value] ?? 0;
              const inputId = `${id}-s-${option.value.replace(/\s+/g, '-')}`;
              return (
                <div key={option.value} className={`form-check ${count === 0 && !checked ? 'is-empty' : ''}`}>
                  <input
                    id={inputId}
                    type="checkbox"
                    className="form-check-input"
                    checked={checked}
                    onChange={() => onToggleSubject(option.label)}
                  />
                  <label className="form-check-label small" htmlFor={inputId}>
                    {option.label}
                    {' '}
                    <span className="filter-chip-count">{count}</span>
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(StudentFilters);
