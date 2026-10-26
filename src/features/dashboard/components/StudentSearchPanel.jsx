import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef } from 'react';
import StudentTable from './StudentTable';
import StudentSearchBar from './StudentSearchBar';
import ClassChips from './ClassChips';
import { useStudentFilters } from '../search/useStudentFilters';
import { buildIndex, classOptions, searchStudents, STATUS_LABELS } from '../search/studentSearch';
import { highlightTerms } from '../search/highlightMatches';
import { DEFAULT_CLASSES } from '@shared/constants/sessions';

// The table re-renders only when its (deferred) results change, never per
// keystroke: typing re-renders the bar and chips, the table catches up.
const ResultsTable = memo(StudentTable);

const classesOf = (doc) => (Array.isArray(doc?.classes) && doc.classes.length > 0 ? doc.classes : DEFAULT_CLASSES);

/**
 * The student list with search and filters — 001Fixes / 04.
 *
 * Searches the roster the dashboard's listener already holds, in memory
 * (search/studentSearch.js): no reads, no network. The typed text and the
 * filters update at once; the results follow through useDeferredValue, so a
 * large class never makes typing stutter. The search state survives switching
 * session tabs, leaving for another page and coming back (useStudentFilters).
 */
export default function StudentSearchPanel({
  session,
  sessionDoc,
  students,
  loading,
  ...tableProps
}) {
  const { state, activeCount, setQuery, toggleClass, toggleStatus, toggleSubject, setRange, clearAll } = useStudentFilters();
  const deferred = useDeferredValue(state);
  const searching = deferred !== state;
  const panelRef = useRef(null);

  const doc = useMemo(() => ({ ...sessionDoc, classes: classesOf(sessionDoc) }), [sessionDoc]);
  const index = useMemo(() => buildIndex(students, session), [students, session]);
  const out = useMemo(
    () => searchStudents(index, deferred, { classOrder: doc.classes }),
    [index, deferred, doc]
  );
  const terms = useMemo(() => highlightTerms(out.query), [out.query]);
  const options = useMemo(() => classOptions([doc], index), [doc, index]);

  // After a search or filter change, bring the top of the results into view
  // if the teacher has scrolled past it (never on first render or a tab switch).
  const signature = JSON.stringify([deferred.q, deferred.classes, deferred.statuses, deferred.subjects, deferred.from, deferred.to, deferred.sort]);
  const firstSignature = useRef(signature);
  useEffect(() => {
    if (signature === firstSignature.current) return;
    firstSignature.current = null;
    const el = panelRef.current;
    if (!el) return;
    const header = document.querySelector('.dashboard-header')?.offsetHeight ?? 0;
    const top = el.getBoundingClientRect().top;
    if (top < header) window.scrollTo({ top: window.scrollY + top - header - 8 });
  }, [signature]);

  const focusFirstRow = useCallback(() => {
    panelRef.current?.querySelector('tr.student-row-wrapper')?.focus();
  }, []);

  // No students, or still loading: the table's own skeleton / "share the
  // registration link" message, exactly as before. Nothing to search yet.
  if (loading || students.length === 0) {
    return <StudentTable key={session} session={session} sessionDoc={sessionDoc} students={students} loading={loading} {...tableProps} />;
  }

  const removable = [
    ...deferred.classes.map((c) => ({ key: `c-${c}`, label: c, remove: () => toggleClass(c) })),
    ...deferred.statuses.map((s) => ({ key: `s-${s}`, label: STATUS_LABELS[s], remove: () => toggleStatus(s) })),
    ...deferred.subjects.map((s) => ({ key: `j-${s}`, label: s, remove: () => toggleSubject(s) })),
    ...(deferred.from || deferred.to
      ? [{ key: 'dates', label: `Registered ${deferred.from ?? '…'} – ${deferred.to ?? '…'}`, remove: () => setRange(null, null) }]
      : []),
  ];

  return (
    <div ref={panelRef} className="student-search-panel">
      <div className="student-search-controls mb-3">
        <StudentSearchBar value={state.q} onChange={setQuery} searching={searching} onArrowDown={focusFirstRow} />
        <ClassChips options={options} selected={state.classes} counts={out.facets.class} onToggle={toggleClass} />
        <div className="student-search-summary small" data-testid="search-summary" aria-live="polite">
          <span className="text-muted">
            {activeCount > 0
              ? <>Showing <strong>{out.total}</strong> of {out.size}</>
              : <>Showing all <strong>{out.size}</strong></>}
            {' '}student{out.size !== 1 ? 's' : ''}
          </span>
          {removable.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="btn btn-sm active-filter"
              onClick={chip.remove}
              aria-label={`Remove filter ${chip.label}`}
            >
              {chip.label} <i className="bi bi-x" aria-hidden="true" />
            </button>
          ))}
          {activeCount > 0 && (
            <button type="button" className="btn btn-sm btn-link px-1" onClick={clearAll}>
              Clear all
            </button>
          )}
        </div>
      </div>

      {out.total === 0 ? (
        <div className="alert alert-light border text-center py-4" data-testid="no-results">
          <i className="bi bi-search fs-4 d-block mb-2 text-muted" aria-hidden="true" />
          <p className="mb-2">No students match your search.</p>
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={clearAll}>
            Clear search and filters
          </button>
        </div>
      ) : (
        <ResultsTable
          key={session}
          session={session}
          sessionDoc={sessionDoc}
          students={out.results}
          totalCount={out.size}
          terms={terms}
          loading={false}
          {...tableProps}
        />
      )}
    </div>
  );
}
