import { memo } from 'react';

/**
 * Class filter chips — 001Fixes / 04. Several may be on at once (any of the
 * selected classes). Each shows how many students it would show given the
 * search and the other filters; a chip at 0 is greyed rather than hidden, so
 * the row never jumps. A selected class this session does not offer (picked on
 * another tab) stays as a chip at 0, which explains an empty list.
 *
 * @param {{ value: string, label: string, offList?: boolean }[]} options
 * @param {string[]} selected  labels as stored in the search state
 * @param {Record<string, number>} counts  keyed by normalised class
 */
function ClassChips({ options, selected, counts, onToggle }) {
  const chosen = new Set(selected.map((s) => s.trim().toLowerCase().replace(/\s+/g, ' ')));
  const known = new Set(options.map((o) => o.label.toLowerCase()));
  const extra = selected
    .filter((label) => !known.has(label.toLowerCase()))
    .map((label) => ({ value: label.toLowerCase(), label, offList: true }));

  return (
    <div className="filter-chip-row" role="group" aria-label="Filter by class">
      <span className="filter-chip-label small fw-semibold text-muted">Class</span>
      <div className="filter-chips">
        {[...options, ...extra].map((option) => {
          const pressed = chosen.has(option.label.toLowerCase());
          const count = counts[option.value] ?? 0;
          return (
            <button
              key={option.value}
              type="button"
              className={`btn btn-sm filter-chip ${pressed ? 'is-active' : ''} ${count === 0 && !pressed ? 'is-empty' : ''}`}
              aria-pressed={pressed}
              onClick={() => onToggle(option.label)}
              title={option.offList ? 'Not on this session\'s class list' : undefined}
            >
              {option.label}
              {/* The space keeps "Form 3" and its count apart for screen
                  readers ("Form 3 2 students", not "Form 32 students"). */}
              {' '}
              <span className="filter-chip-count">{count}</span>
              <span className="visually-hidden"> students</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default memo(ClassChips);
