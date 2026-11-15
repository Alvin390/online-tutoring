/**
 * Duplicate registrations — 003Fixes / 11.
 *
 * Dashboard copy. The server copy is api/_lib/duplicates.js; a parity
 * test keeps the two identical (the studentState convention).
 *
 * Two registrations in the same session are duplicates when (008Fixes / 06b,
 * owner 2026-11-15: "absolutely no duplicates in sessions"):
 *   - THE SAME STUDENT: the same class and names that match — identical once
 *     normalised, or one name's words all inside the other's ("Zawadi" /
 *     "Zawadi Baraka", "Malaika" / "Pendo Malaika") — reason 'name', plus
 *     'receipt' / 'code' / 'number' when those also agree; or
 *   - ONE PAYMENT, TWO REGISTRATIONS: the same M-Pesa code in both receipts,
 *     whatever the names or classes — reason 'payment' (siblings sharing one
 *     payment: the teacher presses "Keep both").
 * Identical receipt text with no code in it pairs only the same student (so
 * generic text like "cash" never pairs strangers). Names in decorative
 * fonts (𝒁𝒂𝒘𝒂𝒅𝒊) are read as plain letters. Staff are never paired, and
 * a pair the teacher chose to keep (`duplicateKeep`) is never flagged again.
 * (Before 06b — 003Fixes / 11, owner choice b — a pair also needed the same
 * receipt, code or a phone 1–2 digits off, and names had to be identical;
 * the 15 Nov list showed 11 live same-session pairs that slipped through.)
 */

const DIACRITICS = /[̀-ͯ]/g;
const ASCII = /^[ -~]*$/; // printable ASCII
const MIN_WORD = 2;
// Longer names are not searched for smaller names inside them (2^k lookups).
const MAX_SUBSET_WORDS = 8;
const APOSTROPHES = /['’‘`]/g;
const HAS_APOSTROPHE = /['’‘`]/;
const ALNUM_RUNS = /[a-z0-9]+/g;
const HAS_DIGIT = /\d/;

/**
 * One pass over a name: its normalised form (letters and digits only, lower
 * case) and its words. Decorative fonts and full-width letters (NFKC) and
 * accents (NFD) are folded first when the name is not plain ASCII.
 * Apostrophes join ("O'Brien" is "obrien"); any other character separates.
 * Single letters (initials) are not words; anything with a digit is ("Student
 * 5" and "Student 15" are different names). Words are kept once each.
 */
function scanName(raw) {
  let text = String(raw ?? '');
  if (!ASCII.test(text)) text = text.normalize('NFKC').normalize('NFD').replace(DIACRITICS, '');
  text = text.toLowerCase();
  if (HAS_APOSTROPHE.test(text)) text = text.replace(APOSTROPHES, '');
  const runs = text.match(ALNUM_RUNS);
  if (!runs) return { name: '', words: [] };
  const words = [];
  for (const w of runs) {
    if ((w.length >= MIN_WORD || HAS_DIGIT.test(w)) && !words.includes(w)) words.push(w);
  }
  return { name: runs.length === 1 ? runs[0] : runs.join(''), words };
}

/** Case, accents, apostrophes, punctuation, spacing and decorative fonts ignored. */
export function normaliseName(name) {
  return scanName(name).name;
}

/** The name's words, each once, normalised like normaliseName (see scanName). */
export function nameWords(name) {
  return scanName(name).words;
}

/** A name's normalised form, words and word-set key (what name matching uses). */
function nameParts(raw) {
  const { name, words } = scanName(raw);
  return { name, words, wordKey: [...words].sort().join(' ') };
}

/** Identical names, the same words in any order, or every word of one inside the other. */
export function namesMatch(a, b) {
  return preparedNamesMatch(nameParts(a), nameParts(b));
}

/**
 * 009Fixes / 02: the SAME student name, for a student finding their own
 * record (stricter than namesMatch, which also matches a name inside a
 * longer one): identical, or the same words in any order, both with at
 * least two words. Decorative fonts, case and accents are ignored as above.
 */
export function sameStudentName(a, b) {
  const pa = nameParts(a);
  const pb = nameParts(b);
  if (pa.words.length < 2 || pb.words.length < 2) return false;
  return pa.name === pb.name || pa.wordKey === pb.wordKey;
}

const isWordChar = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;

/**
 * The 10-character M-Pesa transaction code in a pasted message (any letter
 * case), or null: the first run of word characters that is exactly 10
 * letters and digits with at least one of each. (The same answer as
 * /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}\b/i, scanned by hand: it
 * runs on every record of every roster snapshot.)
 */
export function mpesaCode(text) {
  if (typeof text !== 'string') return null;
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (!isWordChar(text.charCodeAt(i))) { i += 1; continue; }
    let j = i;
    let digit = false;
    let letter = false;
    let underscore = false;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (!isWordChar(c)) break;
      if (c === 95) underscore = true;
      else if (c <= 57) digit = true;
      else letter = true;
      j += 1;
    }
    if (j - i === 10 && digit && letter && !underscore) return text.slice(i, j).toUpperCase();
    i = j;
  }
  return null;
}

/** A code compared as people type it: the letter O and the digit 0 are the same. */
const codeKey = (code) => (code ? code.replace(/O/g, '0') : null);

const digitsOf = (phone) => String(phone ?? '').replace(/\D/g, '');
const receiptText = (text) => String(text ?? '').trim().replace(/\s+/g, ' ');
const phoneOf = (student) => student?.parentPhone ?? student?.phone ?? student?.id ?? '';

function similarDigits(x, y) {
  if (!x || x.length !== y.length) return false;
  let differing = 0;
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] !== y[i]) {
      differing += 1;
      if (differing > 2) return false;
    }
  }
  return differing > 0;
}

/** Same length and 1–2 digits different (a neighbour swap is 2). Never the same number. */
export function similarNumber(a, b) {
  return similarDigits(digitsOf(a), digitsOf(b));
}

/**
 * What the rule needs from one record, worked out once. The receipt text and
 * the phone's digits are only needed for a candidate pair, so they are
 * worked out on first use (most records are never in one).
 */
function prepare(student) {
  const phone = phoneOf(student);
  const scanned = nameParts(student?.studentName); // once: the name, its words and their key
  return {
    student,
    phone,
    digits: undefined,
    text: undefined,
    code: codeKey(mpesaCode(student?.receiptMessage)),
    cls: student?.class ?? '',
    name: scanned.name,
    words: scanned.words,
    // The words as a set, in one string: two names with the same words in any
    // order share it ("Kamau Brian" / "Brian Kamau").
    wordKey: scanned.wordKey,
    keep: Array.isArray(student?.duplicateKeep) ? student.duplicateKeep : null,
    staff: student?.staff === true,
  };
}

/** Every word of `small` is a word of `big` (names have a handful of words). */
function wordsInside(small, big) {
  if (small.length === 0) return false;
  for (const w of small) if (!big.includes(w)) return false;
  return true;
}

function preparedNamesMatch(a, b) {
  if (!a.name) return false;
  if (a.name === b.name || (a.wordKey && a.wordKey === b.wordKey)) return true;
  const [small, big] = a.words.length <= b.words.length ? [a, b] : [b, a];
  // A smaller name inside a very long one is not looked for (findDuplicateGroups).
  return big.words.length <= MAX_SUBSET_WORDS && wordsInside(small.words, big.words);
}

const textOf = (p) => (p.text === undefined ? (p.text = receiptText(p.student?.receiptMessage)) : p.text);
const digitsOfPrepared = (p) => (p.digits === undefined ? (p.digits = digitsOf(p.phone)) : p.digits);

/** The rule on two prepared records. */
function preparedReasons(a, b) {
  if (a.staff || b.staff) return [];
  if (!a.phone || a.phone === b.phone) return [];
  if ((a.keep && a.keep.includes(b.phone)) || (b.keep && b.keep.includes(a.phone))) return [];
  const sameCode = Boolean(a.code) && a.code === b.code;
  if (a.cls === b.cls && preparedNamesMatch(a, b)) {
    const reasons = [];
    const text = textOf(a);
    if (text && text === textOf(b)) reasons.push('receipt');
    else if (sameCode) reasons.push('code');
    if (similarDigits(digitsOfPrepared(a), digitsOfPrepared(b))) reasons.push('number');
    if (reasons.length === 0) reasons.push('name');
    return reasons;
  }
  return sameCode ? ['payment'] : [];
}

/**
 * Why two records match: 'receipt' (the same text), 'code' (the same M-Pesa
 * code in different text), 'number' (similar numbers), 'name' (the same
 * student with nothing else in common), 'payment' (one M-Pesa payment, two
 * different students). Empty when they are not duplicates.
 * @returns {Array<'receipt'|'code'|'number'|'name'|'payment'>}
 */
export function matchReasons(a, b) {
  if (!a || !b) return [];
  return preparedReasons(prepare(a), prepare(b));
}

export function isDuplicatePair(a, b) {
  return matchReasons(a, b).length > 0;
}

/**
 * Every group of records connected by a matching pair. A GROUP is exactly a
 * connected set under matchReasons (tests/unit/fixes006/duplicateGroupsEquivalence).
 * Its PAIRS are what the teacher resolves:
 *   - every pair sharing an M-Pesa code (one payment, two registrations —
 *     always few), and
 *   - for name matches (the same or a contained name in the same class),
 *     only the pairs that connect the group: about one per extra record.
 *     Ten "Amina Wanjiku" in Form 3 are one group of ten shown as nine
 *     pairs, not forty-five (008Fixes / 06b: listing every pair was
 *     quadratic, 2.7 s for 5,000 crowded students, and no help to the
 *     teacher, who merges or keeps one record at a time).
 * Each record is prepared once. Name candidates come from three same-class
 * lookups: the same name; the same words in any order; and every smaller set
 * of a name's own words ("Zawadi Baraka" looks up "zawadi" and "baraka"), so
 * a contained name is found by a handful of lookups, never by scanning
 * everyone who shares a word. They are compared only while not yet connected.
 * Groups, their students and their pairs come out in roster order.
 * @returns {Array<{ students: object[], pairs: Array<{ a: object, b: object, reasons: string[] }> }>}
 */
export function findDuplicateGroups(students) {
  const list = (students ?? []).filter((s) => s && s.staff !== true); // 007Fixes / 08: never paired
  const n = list.length;
  if (n < 2) return [];
  const prepared = list.map(prepare);

  // Plain loops, one Map per key kind, and a lone entry kept as its index (an
  // array only once a second record shares the key): most codes, names and
  // words belong to one record, and this runs on every roster snapshot.
  const add = (map, key, i) => {
    const v = map.get(key);
    if (v === undefined) map.set(key, i);
    else if (typeof v === 'number') map.set(key, [v, i]);
    else v.push(i);
  };
  const byCode = new Map();
  const byClass = new Map(); // class -> { names: name -> index(es), sets: wordKey -> index(es) }
  for (let i = 0; i < n; i += 1) {
    const p = prepared[i];
    if (p.code) add(byCode, p.code, i);
    if (!p.name) continue;
    let c = byClass.get(p.cls);
    if (!c) { c = { names: new Map(), sets: new Map() }; byClass.set(p.cls, c); }
    add(c.names, p.name, i);
    if (p.wordKey) add(c.sets, p.wordKey, i);
  }

  const parent = new Int32Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const root = (i) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) { const next = parent[i]; parent[i] = r; i = next; }
    return r;
  };
  const join = (i, j) => {
    const a = root(i);
    const b = root(j);
    if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; }
  };
  const pairs = [];
  const take = (i, j) => {
    const [x, y] = i < j ? [i, j] : [j, i];
    const reasons = preparedReasons(prepared[x], prepared[y]);
    if (reasons.length === 0) return;
    pairs.push({ i: x, j: y, reasons });
    join(x, y);
  };

  // 1. One payment, two registrations: every pair.
  for (const v of byCode.values()) {
    if (typeof v === 'number') continue;
    for (let x = 0; x < v.length; x += 1) for (let y = x + 1; y < v.length; y += 1) take(v[x], v[y]);
  }
  // 2. The same name, or the same words in any order, in the same class:
  //    only pairs that connect.
  const connectAll = (v) => {
    if (typeof v === 'number') return;
    for (let y = 1; y < v.length; y += 1) {
      for (let x = 0; x < y; x += 1) if (root(v[x]) !== root(v[y])) take(v[x], v[y]);
    }
  };
  for (const c of byClass.values()) {
    for (const v of c.names.values()) connectAll(v);
    for (const v of c.sets.values()) connectAll(v);
  }
  // 3. A smaller name inside this one: look up every smaller set of its own
  //    words (2 lookups for a two-word name, 6 for three). Very long names
  //    (over MAX_SUBSET_WORDS words) are skipped here; they still match by
  //    name, by words in any order, and by payment.
  for (let i = 0; i < n; i += 1) {
    const p = prepared[i];
    const k = p.words.length;
    if (!p.name || k < 2 || k > MAX_SUBSET_WORDS) continue;
    const sorted = p.wordKey.split(' ');
    const sets = byClass.get(p.cls).sets;
    for (let mask = 1; mask < (1 << k) - 1; mask += 1) {
      let key = '';
      for (let b = 0; b < k; b += 1) if (mask & (1 << b)) key = key ? `${key} ${sorted[b]}` : sorted[b];
      const v = sets.get(key);
      if (v === undefined) continue;
      if (typeof v === 'number') { if (root(i) !== root(v)) take(i, v); continue; }
      for (const j of v) if (root(i) !== root(j)) take(i, j);
    }
  }
  if (pairs.length === 0) return [];

  pairs.sort((p, q) => p.i - q.i || p.j - q.j);
  const byRoot = new Map();
  const paired = new Uint8Array(n);
  for (const { i, j } of pairs) { paired[i] = 1; paired[j] = 1; }
  for (let i = 0; i < n; i += 1) {
    if (!paired[i]) continue;
    const r = root(i);
    if (!byRoot.has(r)) byRoot.set(r, { students: [], pairs: [] });
    byRoot.get(r).students.push(list[i]);
  }
  for (const { i, j, reasons } of pairs) byRoot.get(root(i)).pairs.push({ a: list[i], b: list[j], reasons });
  return [...byRoot.values()];
}

// The student page needs only this; it lives in its own small module so the
// page does not load the duplicate rule (008Fixes / 06b, the /:slug budget).
export { retiredMessage } from './retiredMessage';
