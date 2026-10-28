import { memo, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef } from 'react';
import StudentTable from './StudentTable';
import StudentSearchBar from './StudentSearchBar';
import ClassChips from './ClassChips';
import StudentFilters from './StudentFilters';
import { useStudentFilters } from '../search/useStudentFilters';
import {
  buildIndex, classOptions, combineIndexes, didYouMean, searchStudents, subjectOptions, STATUS_LABELS,
} from '../search/studentSearch';
import { highlightTerms } from '../search/highlightMatches';
import { DEFAULT_CLASSES } from '@shared/constants/sessions';

// The table re-renders only when its (deferred) results change, never per
// keystroke: typing re-renders the bar and chips, the table catches up.
const ResultsTable = memo(StudentTable);

const classesOf = (doc) => (Array.isArray(doc?.classes) && doc.classes.length > 0 ? doc.classes : DEFAULT_CLASSES);

/**
 * In the all-sessions view each row carries its session (`__session`) and a
 * key unique across sessions (`__key`: one phone can be registered twice).
 * Tagged copies are cached per index record, so a row object is stable until
 * that student's snapshot changes.
 */
const tagged = new WeakMap();
function tag(record) {
  let row = tagged.get(record);
  if (!row) {
    row = { ...record.student, __session: record.session, __key: record.key };
    tagged.set(record, row);
  }
  return row;
}

const hasCriteria = (s) =>
  Boolean(s.q.trim()) || s.classes.length > 0 || s.statuses.length > 0 || s.subjects.length > 0 || Boolean(s.from || s.to);

/** The filter in words, for the PDF ("Search "wanj" · Form 3 · Owes fees"). */
function describeFilters(s) {
  return [
    s.q.trim() && `Search "${s.q.trim()}"`,
    s.classes.join(', '),
    s.statuses.map((k) => STATUS_LABELS[k]).join(', '),
    s.subjects.join(', '),
    (s.from || s.to) && `Registered ${s.from ?? '…'} – ${s.to ?? '…'}`,
  ].filter(Boolean).join(' · ');
}

/**
 * The student list with search and filters — 001Fixes / 04–06.
 *
 * Searches the rosters the dashboard's listeners already hold, in memory
 * (search/studentSearch.js): no reads, no network. The typed text and the
 * filters update at once; the results follow through useDeferredValue, so a
 * large class never makes typing stutter. The search state survives switching
 * session tabs, leaving for another page and coming back (useStudentFilters).
 *
 * "All sessions" (06) searches every tab's roster at once — the same listener
 * data, no new reads. Each row then shows its session, and every action on it
 * (edit, block, delete, approve, …) goes to THAT session. Export PDF exports
 * what is shown, named by its filter; with no filter it is the old export.
 */
export default function StudentSearchPanel({
  session,
  sessionDoc,
  students,
  sessions = null,
  studentsBySession = null,
  loading,
  onExport,
  ...tableProps
}) {
  const {
    state, activeCount, setQuery, toggleClass, toggleStatus, toggleSubject, setRange, setSort, setScope, clearAll,
  } = useStudentFilters();
  const deferred = useDeferredValue(state);
  const searching = deferred !== state;
  const panelRef = useRef(null);
  const toggleId = useId();

  // Every session this panel can search: the dashboard's tabs, else this one.
  const doc = useMemo(() => ({ ...sessionDoc, classes: classesOf(sessionDoc) }), [sessionDoc]);
  const allDocs = useMemo(
    () => (sessions?.length ? sessions.map((d) => ({ ...d, classes: classesOf(d) })) : [doc]),
    [sessions, doc]
  );
  const canSearchAll = allDocs.length > 1;
  const allMode = canSearchAll && deferred.scope === 'all';

  const sessionIndex = useMemo(() => buildIndex(students, session), [students, session]);
  const allIndex = useMemo(
    () => (canSearchAll
      ? combineIndexes(allDocs.map((d) => (d.id === session ? sessionIndex : buildIndex(studentsBySession?.[d.id] ?? [], d.id))))
      : sessionIndex),
    [canSearchAll, allDocs, session, sessionIndex, studentsBySession]
  );
  const index = allMode ? allIndex : sessionIndex;
  const docs = useMemo(() => (allMode ? allDocs : [doc]), [allMode, allDocs, doc]);
  const classOrder = useMemo(() => [...new Set(docs.flatMap((d) => d.classes))], [docs]);
  const sessionNames = useMemo(() => Object.fromEntries(allDocs.map((d) => [d.id, d.name ?? d.id])), [allDocs]);
  const sessionDocs = useMemo(() => Object.fromEntries(allDocs.map((d) => [d.id, d])), [allDocs]);

  const out = useMemo(() => searchStudents(index, deferred, { classOrder }), [index, deferred, classOrder]);
  const results = useMemo(() => (allMode ? out.records.map(tag) : out.results), [allMode, out]);
  const terms = useMemo(() => highlightTerms(out.query), [out.query]);
  const options = useMemo(() => classOptions(docs, index), [docs, index]);
  // Subject choices follow the selected classes (all classes when none is).
  const subjects = useMemo(() => subjectOptions(docs, deferred.classes, index), [docs, deferred.classes, index]);

  // Only worth computing when a search came back empty.
  const empty = out.total === 0;
  const suggestion = useMemo(
    () => (empty && deferred.q.trim() ? didYouMean(deferred.q, index) : null),
    [empty, deferred.q, index]
  );
  const otherMatches = useMemo(
    () => (empty && !allMode && canSearchAll && hasCriteria(deferred)
      ? searchStudents(allIndex, deferred, { classOrder }).total
      : 0),
    [empty, allMode, canSearchAll, deferred, allIndex, classOrder]
  );

  // After a search or filter change, bring the top of the results into view
  // if the teacher has scrolled past it (never on first render or a tab switch).
  const signature = JSON.stringify([deferred.q, deferred.classes, deferred.statuses, deferred.subjects, deferred.from, deferred.to, deferred.sort, deferred.scope]);
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

  // With nothing filtered in the open session this is exactly the old export.
  const handleExport = useCallback(() => {
    if (!allMode && !hasCriteria(deferred)) {
      onExport?.(session);
      return;
    }
    onExport?.(session, { students: results, subtitle: describeFilters(deferred), allSessions: allMode });
  }, [allMode, deferred, onExport, session, results]);

  // No students, or still loading: the table's own skeleton / "share the
  // registration link" message, exactly as before. Nothing to search yet.
  if (loading || (students.length === 0 && !allMode)) {
    return (
      <StudentTable
        key={session}
        session={session}
        sessionDoc={sessionDoc}
        students={students}
        loading={loading}
        onExport={onExport}
        {...tableProps}
      />
    );
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
        {canSearchAll && (
          <div className="form-check form-switch all-sessions-toggle mb-0">
            <input
              id={toggleId}
              type="checkbox"
              className="form-check-input"
              checked={state.scope === 'all'}
              onChange={(e) => setScope(e.target.checked ? 'all' : 'session')}
            />
            <label className="form-check-label small" htmlFor={toggleId}>
              All sessions <span className="text-muted d-none d-sm-inline">(search every session at once)</span>
            </label>
          </div>
        )}
        <ClassChips options={options} selected={state.classes} counts={out.facets.class} onToggle={toggleClass} />
        <StudentFilters
          state={state}
          statusCounts={out.facets.status}
          subjectOptions={subjects}
          subjectCounts={out.facets.subject}
          onToggleStatus={toggleStatus}
          onToggleSubject={toggleSubject}
          onRange={setRange}
          onSort={setSort}
        />
        <div className="student-search-summary small" data-testid="search-summary" aria-live="polite">
          <span className="text-muted">
            {activeCount > 0
              ? <>Showing <strong>{out.total}</strong> of {out.size}</>
              : <>Showing all <strong>{out.size}</strong></>}
            {' '}student{out.size !== 1 ? 's' : ''}
            {allMode && ' across all sessions'}
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

      {empty ? (
        <div className="alert alert-light border text-center py-4" data-testid="no-results">
          <i className="bi bi-search fs-4 d-block mb-2 text-muted" aria-hidden="true" />
          <p className="mb-2">No students match your search.</p>
          {suggestion && (
            <p className="mb-2">
              Did you mean{' '}
              <button type="button" className="btn btn-link p-0 align-baseline fw-semibold" onClick={() => setQuery(suggestion)}>
                {suggestion}
              </button>
              ?
            </p>
          )}
          {otherMatches > 0 && (
            <p className="mb-2">
              {otherMatches} match{otherMatches === 1 ? '' : 'es'} in other sessions —{' '}
              <button type="button" className="btn btn-link p-0 align-baseline fw-semibold" onClick={() => setScope('all')}>
                Search all sessions
              </button>
            </p>
          )}
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={clearAll}>
            Clear search and filters
          </button>
        </div>
      ) : (
        <ResultsTable
          key={allMode ? 'all-sessions' : session}
          session={session}
          sessionDoc={sessionDoc}
          sessionDocs={sessionDocs}
          sessionNames={sessionNames}
          showSessions={allMode}
          students={results}
          totalCount={out.size}
          pageKey={`${allMode ? '*' : session}|${signature}`}
          terms={terms}
          loading={false}
          onExport={handleExport}
          {...tableProps}
        />
      )}
    </div>
  );
}
