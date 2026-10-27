/**
 * Where the student search state lives — 001Fixes / 04.
 *
 * FILTERS (class, status, subject, dates, sort, scope) go in the URL, so Back
 * and Forward work and a filtered view can be bookmarked. The TYPED SEARCH is
 * kept only in this tab's sessionStorage: it is student names, browser
 * history would keep it after sign-out, and sign-out does clear
 * sessionStorage (clearStoredSearch, called from AuthContext.signOut).
 *
 */

import { STUDENT_SEARCH_STORAGE_KEY } from './searchStorage';

export { STUDENT_SEARCH_STORAGE_KEY, clearStoredSearch } from './searchStorage';

const STATUS_VALUES = ['review', 'owes', 'blocked', 'awaiting', 'rejected'];
const SORT_VALUES = ['newest', 'oldest', 'name', 'name-desc', 'class', 'balance'];
const SCOPE_VALUES = ['session', 'all'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LABEL = 60;
const MAX_VALUES = 30;

export const EMPTY_SEARCH = Object.freeze({
  q: '',
  classes: [],
  statuses: [],
  subjects: [],
  from: null,
  to: null,
  sort: 'newest',
  scope: 'session',
});

/** URL parameter names. Repeated keys carry lists (?class=Form%203&class=Grade%207). */
const PARAM = { classes: 'class', statuses: 'status', subjects: 'subject', from: 'from', to: 'to', sort: 'sort', scope: 'scope' };
const FILTER_PARAMS = Object.values(PARAM);

const cleanLabel = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL);
const uniqueLabels = (values) => {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const label = cleanLabel(raw);
    const key = label.toLowerCase();
    if (label && !seen.has(key) && out.length < MAX_VALUES) {
      seen.add(key);
      out.push(label);
    }
  }
  return out;
};
const validDay = (value) => (DAY.test(String(value ?? '')) && !Number.isNaN(Date.parse(value)) ? String(value) : null);

/** Any value from the URL or storage, made safe; unknown values are dropped. */
export function sanitizeSearch(raw = {}) {
  const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  return {
    q: String(raw.q ?? '').slice(0, 100),
    classes: uniqueLabels(list(raw.classes)),
    statuses: [...new Set(list(raw.statuses).filter((s) => STATUS_VALUES.includes(s)))],
    subjects: uniqueLabels(list(raw.subjects)),
    from: validDay(raw.from),
    to: validDay(raw.to),
    sort: SORT_VALUES.includes(raw.sort) ? raw.sort : 'newest',
    scope: SCOPE_VALUES.includes(raw.scope) ? raw.scope : 'session',
  };
}

/** True when the URL carries any search filter at all. */
export const hasFilterParams = (params) => FILTER_PARAMS.some((name) => params.has(name));

/** The filters in a URL (the typed search is never in the URL). */
export function filtersFromParams(params) {
  return sanitizeSearch({
    classes: params.getAll(PARAM.classes),
    statuses: params.getAll(PARAM.statuses),
    subjects: params.getAll(PARAM.subjects),
    from: params.get(PARAM.from),
    to: params.get(PARAM.to),
    sort: params.get(PARAM.sort),
    scope: params.get(PARAM.scope),
  });
}

/** The URL for a state: unrelated parameters kept, defaults left out. */
export function paramsForState(state, current) {
  const next = new URLSearchParams(current);
  FILTER_PARAMS.forEach((name) => next.delete(name));
  state.classes.forEach((c) => next.append(PARAM.classes, c));
  state.statuses.forEach((s) => next.append(PARAM.statuses, s));
  state.subjects.forEach((s) => next.append(PARAM.subjects, s));
  if (state.from) next.set(PARAM.from, state.from);
  if (state.to) next.set(PARAM.to, state.to);
  if (state.sort !== EMPTY_SEARCH.sort) next.set(PARAM.sort, state.sort);
  if (state.scope !== EMPTY_SEARCH.scope) next.set(PARAM.scope, state.scope);
  return next;
}

/** A comparable key for just the filter part of a URL. */
export function filterKey(params) {
  return FILTER_PARAMS.flatMap((name) => params.getAll(name).map((v) => `${name}=${v}`)).join('&');
}

export function readStoredSearch() {
  try {
    const raw = sessionStorage.getItem(STUDENT_SEARCH_STORAGE_KEY);
    return raw ? sanitizeSearch(JSON.parse(raw)) : null;
  } catch {
    return null; // blocked storage, or a value from an older shape
  }
}

export function writeStoredSearch(state) {
  try {
    sessionStorage.setItem(STUDENT_SEARCH_STORAGE_KEY, JSON.stringify(state));
  } catch { /* storage unavailable: the search simply is not remembered */ }
}
