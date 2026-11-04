/**
 * Duplicate registrations — 003Fixes / 11.
 *
 * Server copy. The dashboard copy is src/shared/utils/duplicates.js; a parity
 * test keeps the two identical (the studentState convention).
 *
 * Two registrations in the same session are duplicates (owner choice b) when
 * they have the same name — normalised as the student search does it — and
 * the same class, AND at least one of:
 *   - the same receipt: the same pasted text, or the same M-Pesa code in it;
 *   - a similar number: same length, 1–2 digits different (which includes two
 *     neighbouring digits swapped).
 * A pair the teacher chose to keep (`duplicateKeep`) is never flagged again.
 */

const DIACRITICS = /[̀-ͯ]/g;
const APOSTROPHES = /['’‘`]/g;
const NON_ALNUM = /[^a-z0-9]+/g;
const ASCII = /^[ -~]*$/; // printable ASCII
const MPESA_CODE = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}\b/;

/** Case, accents, apostrophes, punctuation and spacing ignored. */
export function normaliseName(name) {
  const text = String(name ?? '');
  // Most names are plain ASCII: skip the (slow) accent folding for those.
  return (ASCII.test(text) ? text : text.normalize('NFD').replace(DIACRITICS, ''))
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(NON_ALNUM, '');
}

/** The 10-character M-Pesa transaction code in a pasted message, or null. */
export function mpesaCode(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(MPESA_CODE);
  return match ? match[0] : null;
}

const digitsOf = (phone) => String(phone ?? '').replace(/\D/g, '');
const receiptText = (text) => String(text ?? '').trim().replace(/\s+/g, ' ');
const phoneOf = (student) => student?.parentPhone ?? student?.phone ?? student?.id ?? '';

/** Same length and 1–2 digits different (a neighbour swap is 2). Never the same number. */
export function similarNumber(a, b) {
  const x = digitsOf(a);
  const y = digitsOf(b);
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

const kept = (a, b) => (Array.isArray(a?.duplicateKeep) && a.duplicateKeep.includes(phoneOf(b)))
  || (Array.isArray(b?.duplicateKeep) && b.duplicateKeep.includes(phoneOf(a)));

/**
 * Why two records match, most telling first: 'receipt' (the same text),
 * 'code' (the same M-Pesa code in different text), 'number' (similar
 * numbers). Empty when they are not duplicates.
 * @returns {Array<'receipt'|'code'|'number'>}
 */
export function matchReasons(a, b) {
  if (!a || !b) return [];
  const phoneA = phoneOf(a);
  const phoneB = phoneOf(b);
  if (!phoneA || phoneA === phoneB) return [];
  if ((a.class ?? '') !== (b.class ?? '')) return [];
  const name = normaliseName(a.studentName);
  if (!name || name !== normaliseName(b.studentName)) return [];
  if (kept(a, b)) return [];

  const reasons = [];
  const textA = receiptText(a.receiptMessage);
  if (textA && textA === receiptText(b.receiptMessage)) reasons.push('receipt');
  else {
    const code = mpesaCode(a.receiptMessage);
    if (code && code === mpesaCode(b.receiptMessage)) reasons.push('code');
  }
  if (similarNumber(phoneA, phoneB)) reasons.push('number');
  return reasons;
}

export function isDuplicatePair(a, b) {
  return matchReasons(a, b).length > 0;
}

/**
 * What matchReasons needs from one record, worked out once (006Fixes / 00).
 * Inside a name + class bucket the name and class already match, so a pair
 * only compares these prepared values — the same answer as matchReasons,
 * without re-normalising both records for every pair.
 */
function prepare(student) {
  const phone = phoneOf(student);
  return {
    student,
    phone,
    digits: digitsOf(phone),
    text: receiptText(student.receiptMessage),
    code: undefined, // the M-Pesa code, looked up only when the texts differ
    keep: Array.isArray(student?.duplicateKeep) ? student.duplicateKeep : null,
  };
}

const codeOf = (p) => (p.code === undefined ? (p.code = mpesaCode(p.student.receiptMessage)) : p.code);

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

/** matchReasons for two prepared records of the same bucket. */
function preparedReasons(a, b) {
  if (!a.phone || a.phone === b.phone) return [];
  if ((a.keep && a.keep.includes(b.phone)) || (b.keep && b.keep.includes(a.phone))) return [];
  const reasons = [];
  if (a.text && a.text === b.text) reasons.push('receipt');
  else {
    const code = codeOf(a);
    if (code && code === codeOf(b)) reasons.push('code');
  }
  if (similarDigits(a.digits, b.digits)) reasons.push('number');
  return reasons;
}

/**
 * Every group of records connected by a matching pair, in one pass keyed by
 * name + class (only records sharing both are ever compared). Each record is
 * prepared once and grouping works by index (006Fixes / 00: this was
 * quadratic twice over and took 10 s for 5,000 students).
 * @returns {Array<{ students: object[], pairs: Array<{ a: object, b: object, reasons: string[] }> }>}
 */
export function findDuplicateGroups(students) {
  const buckets = new Map();
  for (const student of students ?? []) {
    const name = normaliseName(student?.studentName);
    if (!name) continue;
    const key = `${name}|${student.class ?? ''}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(student);
    else buckets.set(key, [student]);
  }

  const groups = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const prepared = bucket.map(prepare);
    const pairs = [];
    const pairIndex = [];
    const paired = new Array(bucket.length).fill(false);
    const parent = bucket.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const reasons = preparedReasons(prepared[i], prepared[j]);
        if (reasons.length === 0) continue;
        pairs.push({ a: bucket[i], b: bucket[j], reasons });
        pairIndex.push(i);
        paired[i] = true;
        paired[j] = true;
        parent[root(j)] = root(i);
      }
    }
    if (pairs.length === 0) continue;
    const byRoot = new Map();
    for (let i = 0; i < bucket.length; i += 1) {
      if (!paired[i]) continue;
      const r = root(i);
      if (!byRoot.has(r)) byRoot.set(r, { students: [], pairs: [] });
      byRoot.get(r).students.push(bucket[i]);
    }
    pairs.forEach((pair, k) => byRoot.get(root(pairIndex[k])).pairs.push(pair));
    groups.push(...byRoot.values());
  }
  return groups;
}

/**
 * What a retired number is told (003Fixes / 12) — at check-in and when it
 * tries to register again. A merged number learns only the last 3 digits of
 * the number it was merged into.
 */
export function retiredMessage(reason, keptSuffix) {
  if (reason === 'merged') {
    return keptSuffix
      ? `This number was merged with your other registration. Please check in with your number ending …${keptSuffix}.`
      : 'This number was merged with your other registration. Please check in with your other number.';
  }
  return 'This number was registered twice. Please check in with the number you registered with first, or ask your teacher to change your number.';
}
