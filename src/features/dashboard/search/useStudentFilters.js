import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  EMPTY_SEARCH,
  filterKey,
  filtersFromParams,
  hasFilterParams,
  paramsForState,
  readStoredSearch,
  writeStoredSearch,
} from './searchState';

const URL_WRITE_DELAY_MS = 300;

/** State updater: add `value` to a list field, or remove it (case-insensitive). */
const toggled = (field, value) => (prev) => {
  const key = String(value).toLowerCase();
  const has = prev[field].some((v) => v.toLowerCase() === key);
  return { ...prev, [field]: has ? prev[field].filter((v) => v.toLowerCase() !== key) : [...prev[field], value] };
};

/**
 * The student list's search and filter state — 001Fixes / 04.
 *
 * On mount: filters from the URL when it has any, else the search saved for
 * this tab, else the defaults. The typed text always comes from the tab's
 * saved copy (never the URL — see searchState.js).
 *
 * Changes apply at once; the URL follows 300 ms after the last change, with
 * `replace`, so typing never floods the history. Back/Forward (a URL change
 * this hook did not make) is followed.
 */
export function useStudentFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState(() => {
    const stored = readStoredSearch();
    if (hasFilterParams(searchParams)) return { ...filtersFromParams(searchParams), q: stored?.q ?? '' };
    return stored ?? { ...EMPTY_SEARCH };
  });

  // The filter part of the URL as this hook last wrote (or first read) it.
  const lastWritten = useRef(filterKey(searchParams));
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;

  // Save for this tab immediately; mirror the filters into the URL after a pause.
  useEffect(() => {
    writeStoredSearch(state);
    const timer = setTimeout(() => {
      const next = paramsForState(state, paramsRef.current);
      const key = filterKey(next);
      if (key === filterKey(paramsRef.current)) return;
      lastWritten.current = key;
      setSearchParams(next, { replace: true });
    }, URL_WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, setSearchParams]);

  // Back / Forward: the URL changed under us.
  useEffect(() => {
    const key = filterKey(searchParams);
    if (key === lastWritten.current) return;
    lastWritten.current = key;
    setState((prev) => ({ ...filtersFromParams(searchParams), q: prev.q }));
  }, [searchParams]);

  const setQuery = useCallback((q) => setState((prev) => ({ ...prev, q: String(q ?? '').slice(0, 100) })), []);
  const toggleClass = useCallback((label) => setState(toggled('classes', label)), []);
  const toggleStatus = useCallback((key) => setState(toggled('statuses', key)), []);
  const toggleSubject = useCallback((label) => setState(toggled('subjects', label)), []);
  const setRange = useCallback((from, to) => setState((prev) => ({ ...prev, from: from || null, to: to || null })), []);
  const setSort = useCallback((sort) => setState((prev) => ({ ...prev, sort })), []);
  const setScope = useCallback((scope) => setState((prev) => ({ ...prev, scope })), []);
  const clearAll = useCallback(() => setState((prev) => ({
    ...EMPTY_SEARCH, sort: prev.sort, scope: prev.scope,
  })), []);

  const activeCount = useMemo(
    () => (state.q.trim() ? 1 : 0) + state.classes.length + state.statuses.length + state.subjects.length
      + (state.from ? 1 : 0) + (state.to ? 1 : 0),
    [state]
  );

  return {
    state, activeCount,
    setQuery, toggleClass, toggleStatus, toggleSubject, setRange, setSort, setScope, clearAll,
  };
}
