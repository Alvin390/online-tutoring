import { toDate, fromNairobi } from '@utils/dates';
import { effectiveApprovalStatus } from '@shared/utils/studentState';
import { parseSubjects, subjectsForClass } from '@shared/constants/subjects';
import logger from '@utils/logger';

/**
 * Student search and filtering — 001Fixes / 03.
 *
 * Pure functions over the roster the dashboard ALREADY holds: one live
 * onSnapshot listener per session delivers every student (useDashboard →
 * studentsBySession). Searching that in memory costs no reads, no network and
 * no indexes, and stays live because it is derived from the listener data.
 * Firestore queries or an external engine would add latency and cost and
 * still not do substring or typo matching (issues/001Fixes appendix A).
 *
 * Shape of the work:
 *   buildIndex(students)   once per snapshot (WeakMap-cached on the array)
 *   searchStudents(index)  once per keystroke / filter change: ONE pass that
 *                          scores each student once and fills the results and
 *                          every facet count from that single score
 *
 * Measured on a prototype of this design (issues/001Fixes/plan/evidence):
 * 400 students (4× production) build in ~3 ms and search in under 1 ms; 5,000
 * in ~46 ms and ~8 ms worst case.
 */

export const MAX_QUERY_LENGTH = 100;
export const MAX_TOKENS = 12;

/** Status chips, in display order. */
export const STATUS_KEYS = ['review', 'owes', 'blocked', 'awaiting', 'rejected'];

export const STATUS_LABELS = Object.freeze({
  review: 'Receipt to review',
  owes: 'Owes fees',
  blocked: 'Blocked',
  awaiting: 'Awaiting approval',
  rejected: 'Rejected',
});

export const SORTS = ['newest', 'oldest', 'name', 'name-desc', 'class', 'balance'];

export const DEFAULT_SEARCH_STATE = Object.freeze({
  q: '',
  classes: [],
  statuses: [],
  subjects: [],
  from: null,
  to: null,
  sort: 'newest',
});

// ---------------------------------------------------------------- normalising

const DIACRITICS = /[̀-ͯ]/g;
const APOSTROPHES = /['’‘`]/g;
const NON_ALNUM = /[^a-z0-9]+/g;

/** Lower case, no accents or apostrophes, punctuation as single spaces. */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(NON_ALNUM, ' ')
    .trim();
}

/** A phone in every form a parent might read it out: 2547…, 07…, 7…. */
export function phoneForms(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return [];
  if (digits.startsWith('254') && digits.length > 3) {
    const national = digits.slice(3);
    return [digits, `0${national}`, national];
  }
  return [digits];
}

/**
 * Subject short forms teachers type. Matched in addition to the token itself,
 * so "chem" still finds Chemistry by prefix and "maths" finds Mathematics.
 */
const SUBJECT_ALIASES = {
  maths: 'mathematics',
  math: 'mathematics',
  kisw: 'kiswahili',
  eng: 'english',
  bio: 'biology',
  chem: 'chemistry',
  phy: 'physics',
  phys: 'physics',
  geo: 'geography',
  hist: 'history',
  comp: 'computer',
  agric: 'agriculture',
  biz: 'business',
  csl: 'community service learning',
};

const CLASS_WORD = { f: 'form', form: 'form', g: 'grade', gr: 'grade', grade: 'grade' };
const CLASS_JOINED = /^(form|f|grade|gr|g)(\d{1,2})$/;

/**
 * The query as tokens. Class names typed into the box ("form 3", "f3",
 * "grade10") become class requirements rather than loose words: a bare "3"
 * would otherwise match inside nearly every M-Pesa receipt. Runs of digit
 * groups are joined, so "254722 333 444" is one phone number.
 */
export function parseQuery(q) {
  const text = String(q ?? '').slice(0, MAX_QUERY_LENGTH);
  const words = normalize(text).split(' ').filter(Boolean);

  const classPhrases = [];
  const rest = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const joined = CLASS_JOINED.exec(word);
    if (joined) {
      classPhrases.push(`${CLASS_WORD[joined[1]]} ${Number(joined[2])}`);
    } else if (CLASS_WORD[word] && /^\d{1,2}$/.test(words[i + 1] ?? '')) {
      classPhrases.push(`${CLASS_WORD[word]} ${Number(words[i + 1])}`);
      i += 1;
    } else if (/^\d+$/.test(word) && /^\d+$/.test(rest[rest.length - 1] ?? '') && word.length >= 3) {
      rest[rest.length - 1] += word;
    } else {
      rest.push(word);
    }
  }

  const tokens = rest.slice(0, MAX_TOKENS).map((t) => {
    const digits = /^\d+$/.test(t);
    return {
      t,
      digits,
      phone: digits && t.length >= 3,
      alias: SUBJECT_ALIASES[t] ?? null,
      // Typo budget: names only, never digits, never under 4 characters.
      typo: digits ? 0 : t.length >= 8 ? 2 : t.length >= 4 ? 1 : 0,
    };
  });

  return { text, tokens, classPhrases: [...new Set(classPhrases)], joined: tokens.map((x) => x.t).join(' ') };
}

// ------------------------------------------------------------------ the index

const EMPTY_FLAGS = Object.freeze({ review: false, owes: false, blocked: false, awaiting: false, rejected: false });

function makeRecord(student, session) {
  if (!student || typeof student !== 'object') return null;
  const name = normalize(student.studentName);
  const cls = normalize(student.class);
  const subjectLabels = (() => {
    try { return parseSubjects(student.subjects); } catch { return []; }
  })();
  const balance = Number(student.feeBalance);
  const approval = effectiveApprovalStatus(student);
  const registered = toDate(student.registeredAt);
  const id = String(student.id ?? '');
  return {
    student,
    id,
    // The same parent phone can be registered in two sessions, so across
    // sessions a student is identified by session AND phone.
    key: session ? `${session}/${id}` : id,
    session,
    name,
    nameTokens: name ? name.split(' ') : [],
    phones: [...new Set([...phoneForms(student.id), ...phoneForms(student.parentPhone)])],
    cls,
    clsWords: cls ? cls.split(' ') : [],
    clsLabel: String(student.class ?? '').trim(),
    subjects: subjectLabels.map(normalize),
    subjectLabels,
    receipt: String(student.receiptMessage ?? '').toLowerCase(),
    balance: Number.isFinite(balance) ? balance : 0,
    at: registered ? registered.getTime() : null,
    flags: {
      review: student.receiptStatus === 'pending' && Boolean(student.pendingReceipt),
      owes: Number.isFinite(balance) && balance > 0,
      blocked: student.blocked === true,
      awaiting: approval === 'pending',
      rejected: approval === 'rejected',
    },
  };
}

const indexCache = new WeakMap();

/**
 * One search record per student, cached per snapshot ARRAY: the listener
 * hands over a new array whenever anything changes, so the index is rebuilt
 * exactly then and never per keystroke. `session` tags every record, for the
 * all-sessions view.
 */
export function buildIndex(students, session = null) {
  const list = students ?? [];
  const cachedBySession = typeof list === 'object' ? indexCache.get(list) : undefined;
  if (cachedBySession?.has(session)) return cachedBySession.get(session);

  let index;
  try {
    const records = [];
    for (const student of list) {
      let record = null;
      try {
        record = makeRecord(student, session);
      } catch {
        record = null; // A malformed document is skipped, never thrown on.
      }
      if (record) records.push(record);
    }
    index = { records, session, fallback: null };
  } catch (error) {
    logger.warn('Student search index could not be built; using plain name matching', { error: error?.message });
    index = { records: null, session, fallback: list };
  }

  if (typeof list === 'object') {
    const bySession = cachedBySession ?? new Map();
    bySession.set(session, index);
    if (!cachedBySession) indexCache.set(list, bySession);
  }
  return index;
}

/**
 * One index over several sessions (001Fixes / 06): the per-session indexes,
 * each built from its own listener array and cached, concatenated. No
 * re-normalising — switching to "All sessions" reuses the work already done.
 */
export function combineIndexes(indexes) {
  const records = [];
  for (const index of indexes) {
    if (index?.records) records.push(...index.records);
  }
  return { records, session: null, fallback: null };
}

// -------------------------------------------------------------------- scoring

// Optimal-string-alignment distance with early exit, on three reused rows:
// no allocation per comparison, so typo matching stays cheap in a hot loop.
const ROW_A = new Int32Array(64);
const ROW_B = new Int32Array(64);
const ROW_C = new Int32Array(64);

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length > 60 || b.length > 60) return max + 1;
  let prev2 = ROW_A;
  let prev = ROW_B;
  let row = ROW_C;
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    row[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2] + 1);
      }
      row[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    const spare = prev2;
    prev2 = prev;
    prev = row;
    row = spare;
  }
  return prev[b.length];
}

const SCORE = {
  nameExact: 100, // bonus: the whole query is the whole name
  nameToken: 70,
  namePrefix: 60,
  phone: 50,
  nameSubstring: 40,
  className: 20,
  subject: 15,
  typo: 10,
  receipt: 5,
};

function tokenScore(record, token) {
  const { t } = token;
  if (token.phone && record.phones.some((p) => p.includes(t))) return SCORE.phone;
  // One- or two-digit fragments only ever mean a class ("10").
  if (token.digits && !token.phone) return record.clsWords.includes(t) ? SCORE.className : 0;
  if (!token.digits) {
    if (record.nameTokens.includes(t)) return SCORE.nameToken;
    if (record.nameTokens.some((w) => w.startsWith(t))) return SCORE.namePrefix;
    if (record.name.includes(t)) return SCORE.nameSubstring;
    if (record.cls.includes(t)) return SCORE.className;
    if (record.subjects.some((s) => s.includes(t) || (token.alias && s.includes(token.alias)))) return SCORE.subject;
  }
  if (t.length >= 4 && record.receipt.includes(t)) return SCORE.receipt;
  if (token.typo && record.nameTokens.some((w) => editDistance(t, w, token.typo) <= token.typo)) return SCORE.typo;
  return 0;
}

/** 0 = no match; otherwise higher is better. */
function scoreRecord(record, query) {
  if (query.classPhrases.length > 0 && !query.classPhrases.includes(record.cls)) return 0;
  let total = 0;
  for (const token of query.tokens) {
    const score = tokenScore(record, token);
    if (!score) return 0;
    total += score;
  }
  if (query.joined && query.joined === record.name) total += SCORE.nameExact;
  return total || 1;
}

// ------------------------------------------------------------------- filters

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A YYYY-MM-DD date as the first (or last) millisecond of that Nairobi day. */
function nairobiDayBound(value, end) {
  const m = DAY.exec(String(value ?? ''));
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return end
    ? fromNairobi({ year, month, day: day + 1 }).getTime() - 1
    : fromNairobi({ year, month, day }).getTime();
}

/** Validated, normalised filter state; unknown values are dropped. */
export function normalizeState(state = {}) {
  const list = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
  const cleanList = (value) => [...new Set(list(value).map(normalize).filter(Boolean))];
  return {
    q: String(state.q ?? '').slice(0, MAX_QUERY_LENGTH),
    classes: cleanList(state.classes),
    statuses: [...new Set(list(state.statuses).filter((s) => STATUS_KEYS.includes(s)))],
    subjects: cleanList(state.subjects),
    from: nairobiDayBound(state.from, false) === null ? null : String(state.from),
    to: nairobiDayBound(state.to, true) === null ? null : String(state.to),
    sort: SORTS.includes(state.sort) ? state.sort : 'newest',
  };
}

// The key, not the id: across sessions one phone can appear twice. Within a
// session the key IS the id.
const byId = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || byId(a, b);
const newestFirst = (a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || byId(a, b);
const oldestFirst = (a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || byId(a, b);

function comparator(sort, classOrder) {
  switch (sort) {
    case 'oldest': return oldestFirst;
    case 'name': return byName;
    case 'name-desc': return (a, b) => byName(b, a);
    case 'balance': return (a, b) => b.balance - a.balance || byName(a, b);
    case 'class': {
      const rank = new Map(classOrder.map((c, i) => [normalize(c), i]));
      const of = (r) => (rank.has(r.cls) ? rank.get(r.cls) : Number.MAX_SAFE_INTEGER);
      return (a, b) => of(a) - of(b) || (a.cls < b.cls ? -1 : a.cls > b.cls ? 1 : 0) || byName(a, b);
    }
    default: return newestFirst;
  }
}

function fallbackSearch(list, state) {
  const needle = normalize(state.q);
  const results = [];
  for (let i = 0; i < (list?.length ?? 0); i += 1) {
    try {
      const s = list[i];
      if (s && (!needle || normalize(s.studentName).includes(needle))) results.push(s);
    } catch { /* skip */ }
  }
  return {
    results,
    total: results.length,
    size: list?.length ?? 0,
    facets: { class: {}, status: Object.fromEntries(STATUS_KEYS.map((k) => [k, 0])), subject: {} },
    query: parseQuery(state.q),
    fallback: true,
  };
}

/**
 * Search + filter + sort + facet counts in ONE pass over the index.
 *
 * Filters are OR within a group and AND across groups. Each group's facet
 * counts are computed as if that group's own selection were cleared (so a
 * chip shows what ticking it would add), given the query, the date range and
 * the other groups.
 *
 * @param {{records: object[]|null, fallback: unknown[]|null}} index  buildIndex(...)
 * @param {typeof DEFAULT_SEARCH_STATE} rawState
 * @param {{classOrder?: string[]}} options  classOrder drives the 'class' sort
 */
export function searchStudents(index, rawState = DEFAULT_SEARCH_STATE, { classOrder = [] } = {}) {
  const state = normalizeState(rawState);
  if (!index?.records) return fallbackSearch(index?.fallback, state);

  const query = parseQuery(state.q);
  const from = state.from ? nairobiDayBound(state.from, false) : null;
  const to = state.to ? nairobiDayBound(state.to, true) : null;
  const classSet = new Set(state.classes);
  const subjectSet = new Set(state.subjects);
  const statuses = state.statuses;

  const facets = {
    class: {},
    status: Object.fromEntries(STATUS_KEYS.map((k) => [k, 0])),
    subject: {},
  };
  const hits = [];

  for (const record of index.records) {
    if (from !== null && (record.at === null || record.at < from)) continue;
    if (to !== null && (record.at === null || record.at > to)) continue;
    const score = query.tokens.length || query.classPhrases.length ? scoreRecord(record, query) : 1;
    if (!score) continue;

    const passClass = classSet.size === 0 || classSet.has(record.cls);
    const passStatus = statuses.length === 0 || statuses.some((k) => record.flags[k]);
    const passSubject = subjectSet.size === 0 || record.subjects.some((s) => subjectSet.has(s));

    if (passStatus && passSubject && record.cls) {
      facets.class[record.cls] = (facets.class[record.cls] ?? 0) + 1;
    }
    if (passClass && passSubject) {
      for (const key of STATUS_KEYS) if (record.flags[key]) facets.status[key] += 1;
    }
    if (passClass && passStatus) {
      for (const subject of new Set(record.subjects)) facets.subject[subject] = (facets.subject[subject] ?? 0) + 1;
    }
    if (passClass && passStatus && passSubject) hits.push({ record, score });
  }

  const order = comparator(state.sort, classOrder);
  hits.sort(query.tokens.length > 0
    ? (a, b) => b.score - a.score || order(a.record, b.record)
    : (a, b) => order(a.record, b.record));

  return {
    results: hits.map((h) => h.record.student),
    records: hits.map((h) => h.record),
    total: hits.length,
    size: index.records.length,
    facets,
    query,
    fallback: false,
  };
}

// ------------------------------------------------------------- option lists

const recordsOf = (index) => index?.records ?? [];

/**
 * Class chips: the sessions' own lists in the teacher's order (deduplicated
 * across sessions), then any class found only on students, marked offList.
 */
export function classOptions(sessionDocs, index) {
  const seen = new Map();
  for (const doc of sessionDocs ?? []) {
    for (const label of Array.isArray(doc?.classes) ? doc.classes : []) {
      const value = normalize(label);
      if (value && !seen.has(value)) seen.set(value, { value, label: String(label).trim(), offList: false });
    }
  }
  const extra = new Map();
  for (const record of recordsOf(index)) {
    if (record.cls && !seen.has(record.cls) && !extra.has(record.cls)) {
      extra.set(record.cls, { value: record.cls, label: record.clsLabel, offList: true });
    }
  }
  const extras = [...extra.values()].sort((a, b) => (a.value < b.value ? -1 : 1));
  return [...seen.values(), ...extras];
}

/**
 * Subject options for the selected classes (all classes when none is
 * selected): each session's list for those classes first, in its order, then
 * subjects found on matching students, alphabetically. Case-insensitive
 * de-duplication; the first spelling seen is the label.
 */
export function subjectOptions(sessionDocs, selectedClasses, index) {
  const wanted = new Set((selectedClasses ?? []).map(normalize).filter(Boolean));
  const listed = new Map();
  for (const doc of sessionDocs ?? []) {
    const classes = Array.isArray(doc?.classes) ? doc.classes : [];
    for (const cls of classes) {
      if (wanted.size > 0 && !wanted.has(normalize(cls))) continue;
      for (const subject of subjectsForClass(doc, cls)) {
        const value = normalize(subject.name);
        if (value && !listed.has(value)) listed.set(value, { value, label: subject.name });
      }
    }
  }
  const found = new Map();
  for (const record of recordsOf(index)) {
    if (wanted.size > 0 && !wanted.has(record.cls)) continue;
    record.subjects.forEach((value, i) => {
      if (value && !listed.has(value) && !found.has(value)) found.set(value, { value, label: record.subjectLabels[i] });
    });
  }
  const extras = [...found.values()].sort((a, b) => (a.value < b.value ? -1 : 1));
  return [...listed.values(), ...extras];
}

// ------------------------------------------------------------- did you mean

/**
 * The student name closest to a query that matched nothing: every query word
 * of 3+ letters must be within about a third of its length of some word in
 * the name. Returns the name as written, or null.
 */
export function didYouMean(q, index) {
  const words = normalize(q).split(' ').filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  if (words.length === 0) return null;
  let best = null;
  for (const record of recordsOf(index)) {
    let total = 0;
    for (const word of words) {
      const max = Math.max(1, Math.floor(word.length / 3));
      let closest = max + 1;
      for (const nameWord of record.nameTokens) {
        closest = Math.min(closest, editDistance(word, nameWord, max));
        if (closest === 0) break;
      }
      if (closest > max) { total = -1; break; }
      total += closest;
    }
    if (total < 0) continue;
    if (!best || total < best.total || (total === best.total && record.name < best.record.name)) {
      best = { total, record };
    }
  }
  return best ? String(best.record.student.studentName ?? '').trim() || null : null;
}
