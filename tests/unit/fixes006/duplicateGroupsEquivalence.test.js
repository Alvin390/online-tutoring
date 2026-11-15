import { describe, it, expect } from 'vitest';
import * as client from '../../../src/shared/utils/duplicates.js';
import * as server from '../../../api/_lib/duplicates.js';

/**
 * 006Fixes / 00 — findDuplicateGroups was made fast. Its GROUPS must stay
 * exactly what the rule says: the records connected by matchReasons.
 *
 * 008Fixes / 06b: pairs now cross name buckets (one M-Pesa payment on two
 * students; one name inside another), and name matches list only the pairs
 * that connect a group (all of them was quadratic). So the reference checks:
 *   - the groups (members, in roster order) are exactly the connected sets
 *     of EVERY pair of non-staff records through matchReasons;
 *   - every listed pair is a real match, with matchReasons' own reasons;
 *   - every pair sharing an M-Pesa code (that matches) is listed;
 *   - each group's listed pairs connect all its members.
 */
function components(lib, students) {
  const list = (students ?? []).filter((s) => s && s.staff !== true);
  const parent = list.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const linked = new Set();
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (!lib.matchReasons(list[i], list[j]).length) continue;
      linked.add(i).add(j);
      const a = root(i);
      const b = root(j);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const groups = new Map();
  list.forEach((s, i) => {
    if (!linked.has(i)) return;
    const r = root(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(s.id);
  });
  return [...groups.values()];
}

const codeKey = (lib, text) => (lib.mpesaCode(text) ?? '').replace(/O/g, '0');

function checkGroups(lib, students) {
  const groups = lib.findDuplicateGroups(students);
  expect(groups.map((g) => g.students.map((s) => s.id))).toEqual(components(lib, students));
  const listed = new Set();
  for (const g of groups) {
    const ids = new Set(g.students.map((s) => s.id));
    const parent = new Map(g.students.map((s) => [s.id, s.id]));
    const root = (x) => (parent.get(x) === x ? x : root(parent.get(x)));
    for (const p of g.pairs) {
      expect(ids.has(p.a.id) && ids.has(p.b.id)).toBe(true);
      expect(p.reasons).toEqual(lib.matchReasons(p.a, p.b));
      expect(p.reasons.length).toBeGreaterThan(0);
      listed.add(`${p.a.id}|${p.b.id}`).add(`${p.b.id}|${p.a.id}`);
      parent.set(root(p.a.id), root(p.b.id));
    }
    expect(new Set(g.students.map((s) => root(s.id))).size).toBe(1); // connected
  }
  const list = (students ?? []).filter((s) => s && s.staff !== true);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const code = codeKey(lib, list[i].receiptMessage);
      if (code && code === codeKey(lib, list[j].receiptMessage) && lib.matchReasons(list[i], list[j]).length) {
        expect(listed.has(`${list[i].id}|${list[j].id}`)).toBe(true);
      }
    }
  }
  return groups;
}

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
    it(`${label}: groups are exactly the rule's connected sets on 40 random rosters`, () => {
      for (let seed = 1; seed <= 40; seed += 1) {
        const students = roster(seed, 20 + (seed % 7) * 15);
        checkGroups(lib, students);
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
