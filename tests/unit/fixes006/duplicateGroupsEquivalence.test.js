import { describe, it, expect } from 'vitest';
import * as client from '../../../src/shared/utils/duplicates.js';
import * as server from '../../../api/_lib/duplicates.js';

/**
 * 006Fixes / 00 — findDuplicateGroups was made fast (each student normalised
 * once per bucket; grouping by index). Its result must stay EXACTLY what the
 * rule says: every pair through matchReasons, connected into groups. This
 * reference is the pre-006 algorithm, written plainly.
 */
function reference(lib, students) {
  const buckets = new Map();
  for (const s of students ?? []) {
    const name = lib.normaliseName(s?.studentName);
    if (!name) continue;
    const key = `${name}|${s.class ?? ''}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  }
  const groups = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const pairs = [];
    const parent = bucket.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const reasons = lib.matchReasons(bucket[i], bucket[j]);
        if (!reasons.length) continue;
        pairs.push({ a: bucket[i], b: bucket[j], reasons });
        parent[root(j)] = root(i);
      }
    }
    if (!pairs.length) continue;
    const byRoot = new Map();
    bucket.forEach((s, i) => {
      if (!pairs.some((p) => p.a === s || p.b === s)) return;
      const r = root(i);
      if (!byRoot.has(r)) byRoot.set(r, { students: [], pairs: [] });
      byRoot.get(r).students.push(s);
    });
    for (const p of pairs) byRoot.get(root(bucket.indexOf(p.a))).pairs.push(p);
    groups.push(...byRoot.values());
  }
  return groups;
}

/** Comparable shape: ids instead of object identity. */
const shape = (groups) => groups.map((g) => ({
  students: g.students.map((s) => s.id),
  pairs: g.pairs.map((p) => [p.a.id, p.b.id, p.reasons.join('+')]),
}));

const NAMES = ['Amina Wanjiku', 'amina  wanjiku', "Zoë O'Brien", 'Zoe OBrien', 'Brian Kamau', 'BRIAN KAMAU', 'Faith', '', '  ', 'Kevin Otieno'];
const CLASSES = ['Grade 7', 'Form 3', undefined];
const RECEIPTS = [
  'QAB123XYZ9 Confirmed. Ksh1,500.00 sent',
  'QAB123XYZ9  Confirmed.  Ksh1,500.00 sent', // same text after spacing
  'Paid via QAB123XYZ9 yesterday', // same code, different text
  'UK1GBBUHOJ Confirmed. Ksh1,100.00',
  '',
  undefined,
  'cash',
];

function roster(seed, n) {
  let x = seed;
  const rnd = (k) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return (x >>> 8) % k; };
  const base = 712345670;
  return Array.from({ length: n }, (_, i) => {
    const digits = String(base + rnd(40)).split('');
    if (rnd(3) === 0) { const k = rnd(9); [digits[k], digits[k + 1]] = [digits[k + 1], digits[k]]; }
    const phone = rnd(25) === 0 ? '' : `+254${digits.join('')}`;
    const s = {
      id: `s${i}`,
      studentName: NAMES[rnd(NAMES.length)],
      class: CLASSES[rnd(CLASSES.length)],
      receiptMessage: RECEIPTS[rnd(RECEIPTS.length)],
    };
    if (rnd(2)) s.parentPhone = phone; else s.phone = phone;
    return s;
  }).map((s, _i, all) => {
    // Some keeps, pointing at real numbers in the roster.
    if (rnd(6) === 0) {
      const other = all[rnd(all.length)];
      s.duplicateKeep = [other.parentPhone ?? other.phone ?? other.id];
    }
    return s;
  });
}

describe('006Fixes / 00: fast findDuplicateGroups gives exactly the rule\'s groups', () => {
  for (const [label, lib] of [['dashboard copy', client], ['server copy', server]]) {
    it(`${label}: matches the plain reference on 40 random rosters`, () => {
      for (let seed = 1; seed <= 40; seed += 1) {
        const students = roster(seed, 20 + (seed % 7) * 15);
        expect(shape(lib.findDuplicateGroups(students))).toEqual(shape(reference(lib, students)));
      }
    });
  }

  it('empty and missing input', () => {
    expect(client.findDuplicateGroups([])).toEqual([]);
    expect(client.findDuplicateGroups(undefined)).toEqual([]);
    expect(server.findDuplicateGroups(null)).toEqual([]);
  });

  it('the rosters actually contain duplicates (the test is not vacuous)', () => {
    const total = Array.from({ length: 40 }, (_, k) => client.findDuplicateGroups(roster(k + 1, 60)).length).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(40);
  });
});
