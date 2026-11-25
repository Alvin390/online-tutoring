import { describe, it, expect } from 'vitest';
import {
  normaliseName, mpesaCode, similarNumber, matchReasons, isDuplicatePair, findDuplicateGroups,
} from '@utils/duplicates';

/**
 * 003Fixes / 11 — the duplicate rule (owner choice b): same session, same
 * name (normalised as the search does), same class, and either the same
 * receipt (text or M-Pesa code) or a number 1–2 digits off / two neighbours swapped.
 */

const s = (over) => ({
  parentPhone: '+254711000001', studentName: 'Amina Wanjiru', class: 'Grade 7',
  receiptMessage: 'QX12345678 Confirmed. Ksh1,000.00 sent to TEACHER', ...over,
});

describe('normaliseName', () => {
  it('ignores case, accents, apostrophes, punctuation and spacing', () => {
    expect(normaliseName("Zoë O'Brien")).toBe(normaliseName('zoe  obrien'));
    expect(normaliseName('Mary-Jane  Mwangi ')).toBe(normaliseName('mary jane mwangi'));
    expect(normaliseName('Amina')).not.toBe(normaliseName('Aminah'));
  });
});

describe('mpesaCode', () => {
  it('finds the 10-character code; none in plain text', () => {
    expect(mpesaCode('QX12345678 Confirmed. Ksh1,000.00')).toBe('QX12345678');
    expect(mpesaCode('Confirmed. I paid 1000 from 0712345678')).toBeNull();
    expect(mpesaCode(undefined)).toBeNull();
  });
});

describe('similarNumber', () => {
  it('1 or 2 digits different, or neighbours swapped; not 3, not a different length', () => {
    expect(similarNumber('+254711000001', '+254711000002')).toBe(true);
    expect(similarNumber('+254711000001', '+254711000032')).toBe(true);
    expect(similarNumber('+254711000012', '+254711000021')).toBe(true);
    expect(similarNumber('+254711000001', '+254711000432')).toBe(false);
    expect(similarNumber('+254711000001', '+25471100001')).toBe(false);
    expect(similarNumber('+254711000001', '+254711000001')).toBe(false);
  });
});

describe('isDuplicatePair', () => {
  it('same name + class + same receipt text, any number', () => {
    expect(matchReasons(s(), s({ parentPhone: '+254799888777' }))).toEqual(['receipt']);
    expect(isDuplicatePair(s(), s({ parentPhone: '+254799888777', studentName: "  amina   WANJIRU" }))).toBe(true);
  });
  it('same M-Pesa code inside different text', () => {
    const other = s({ parentPhone: '+254799888777', receiptMessage: 'paid: QX12345678 confirmed ksh 1000' });
    expect(matchReasons(s(), other)).toEqual(['code']);
  });
  it('a different receipt but a number 1 digit off', () => {
    expect(matchReasons(s(), s({ parentPhone: '+254711000007', receiptMessage: 'RZ98765432 Confirmed.' }))).toEqual(['number']);
  });
  // 008Fixes / 06b (owner, 2026-11-15: "absolutely no duplicates in
  // sessions"): one M-Pesa payment on two registrations is a duplicate
  // whatever the names or classes, and the same name in the same class is a
  // duplicate on its own. tests/unit/fixes008/duplicateRuleA2.test.js has the rest.
  it('008Fixes / 06b: the same payment in another class or under another name; the same name and class alone', () => {
    expect(matchReasons(s(), s({ parentPhone: '+254799888777', class: 'Grade 8' }))).toEqual(['payment']);
    expect(matchReasons(s(), s({ parentPhone: '+254799888777', studentName: 'Amina Otieno' }))).toEqual(['payment']);
    expect(matchReasons(s(), s({ parentPhone: '+254799888777', receiptMessage: 'RZ98765432 Confirmed.' }))).toEqual(['name']);
  });
  it('not a duplicate: a different class or name AND a different payment; the same record', () => {
    const other = { parentPhone: '+254799888777', receiptMessage: 'RZ98765432 Confirmed.' };
    expect(isDuplicatePair(s(), s({ ...other, class: 'Grade 8' }))).toBe(false);
    expect(isDuplicatePair(s(), s({ ...other, studentName: 'Amina Otieno' }))).toBe(false);
    expect(isDuplicatePair(s(), s())).toBe(false); // the same record
  });
  it('a pair the teacher kept is never flagged again', () => {
    const b = s({ parentPhone: '+254799888777' });
    expect(isDuplicatePair({ ...s(), duplicateKeep: ['+254799888777'] }, b)).toBe(false);
    expect(isDuplicatePair(s(), { ...b, duplicateKeep: ['+254711000001'] })).toBe(false);
  });
});

describe('findDuplicateGroups', () => {
  it('groups records connected by any matching pair, with the reasons', () => {
    const students = [
      s(),
      s({ parentPhone: '+254711000002', receiptMessage: 'other text' }), // number
      s({ parentPhone: '+254799888777' }), // receipt
      s({ parentPhone: '+254700000000', studentName: 'Brian' }), // 008Fixes / 06b: the same payment
      s({ parentPhone: '+254700000099', studentName: 'Kevin', receiptMessage: 'cash' }), // nothing in common
    ];
    const groups = findDuplicateGroups(students);
    expect(groups).toHaveLength(1);
    expect(groups[0].students.map((x) => x.parentPhone).sort()).toEqual(['+254700000000', '+254711000001', '+254711000002', '+254799888777']);
    expect(groups[0].pairs.length).toBeGreaterThanOrEqual(2);
  });
  it('500 students in under 5 ms', () => {
    const students = Array.from({ length: 500 }, (_, i) => s({
      parentPhone: `+2547${String(10000000 + i * 7919).slice(0, 8)}`,
      studentName: `Student ${i % 450}`, class: `Grade ${i % 4}`, receiptMessage: `R${String(i).padStart(9, '0')} x`,
    }));
    findDuplicateGroups(students);
    // 014Fixes: the middle of 7 runs, not one: a single run on a shared CI
    // machine measured 5.9 and 6.3 ms; a real slowdown still fails every run.
    const runs = [];
    for (let i = 0; i < 7; i += 1) {
      const t0 = performance.now();
      findDuplicateGroups(students);
      runs.push(performance.now() - t0);
    }
    expect(runs.sort((x, y) => x - y)[3]).toBeLessThan(5);
  });
});
