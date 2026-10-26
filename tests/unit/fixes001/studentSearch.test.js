import { describe, it, expect, vi } from 'vitest';
import {
  normalize,
  phoneForms,
  parseQuery,
  buildIndex,
  searchStudents,
  classOptions,
  subjectOptions,
  didYouMean,
  STATUS_KEYS,
  SORTS,
  DEFAULT_SEARCH_STATE,
  MAX_QUERY_LENGTH,
  MAX_TOKENS,
} from '@features/dashboard/search/studentSearch';

/**
 * 001Fixes / 03 — the in-memory student search engine. Pure functions over the
 * roster the dashboard's listeners already hold: no reads, no network.
 */

const at = (iso) => ({ toMillis: () => Date.parse(iso) });
let seq = 0;
const student = (over = {}) => {
  seq += 1;
  return {
    id: `+2547110000${String(seq).padStart(2, '0')}`,
    studentName: `Student ${seq}`,
    class: 'Grade 8',
    subjects: 'English, Mathematics',
    receiptMessage: `RCP${seq}ABC9 Confirmed. Ksh1,500.00 sent to TUTOR on 1/10/26 at 8:15 AM`,
    receiptStatus: 'pending',
    approvalStatus: 'approved',
    blocked: false,
    feeBalance: 0,
    registeredAt: at('2026-10-01T09:00:00+03:00'),
    ...over,
  };
};

const roster = () => [
  student({ id: '+254711000001', studentName: 'Amina Wanjiru', class: 'Form 3', subjects: 'English, Kiswahili, Mathematics, Biology', receiptMessage: 'QAB1XYZ9 Confirmed. Ksh1,500.00 sent to TUTOR', registeredAt: at('2026-10-05T10:00:00+03:00') }),
  student({ id: '+254711000002', studentName: "Sean O'Brien", class: 'Grade 10', subjects: 'English, Physics, Community Service Learning (CSL)', feeBalance: 1500, registeredAt: at('2026-10-03T10:00:00+03:00') }),
  student({ id: '+254711000003', studentName: 'Zoë Achieng', class: 'Grade 7', subjects: 'English, Kiswahili', blocked: true, registeredAt: at('2026-10-04T23:30:00+03:00') }),
  student({ id: '+254722333444', studentName: 'Brian Otieno', class: 'Form 3', subjects: 'English, Kiswahili, Mathematics, Chemistry', receiptStatus: 'pending', pendingReceipt: 'QZZ9988776 Confirmed', registeredAt: at('2026-10-02T08:00:00+03:00') }),
  student({ id: '+254733000005', studentName: 'Mercy Wambui', class: 'Grade 8', approvalStatus: 'pending', registeredAt: at('2026-10-06T07:00:00+03:00') }),
  student({ id: '+254733000006', studentName: 'Kevin Mutua', class: 'Grade 8', approvalStatus: 'rejected', registeredAt: at('2026-09-30T12:00:00+03:00') }),
  student({ id: '+254733000007', studentName: 'Amina Chebet', class: 'Grade 10', subjects: 'Mathematics, Biology', registeredAt: at('2026-10-05T09:00:00+03:00') }),
];

const run = (students, state = {}, options = {}) =>
  searchStudents(buildIndex(students), { ...DEFAULT_SEARCH_STATE, ...state }, options);
const names = (out) => out.results.map((s) => s.studentName);

// ---------------------------------------------------------------------------
describe('normalisation', () => {
  it('folds case, accents, apostrophes and punctuation; collapses spaces', () => {
    expect(normalize('  Zoë   ACHIENG ')).toBe('zoe achieng');
    expect(normalize("O'Brien")).toBe('obrien');
    expect(normalize('N’Golo-Kanté')).toBe('ngolo kante');
    expect(normalize('Community Service Learning (CSL)')).toBe('community service learning csl');
    expect(normalize(null)).toBe('');
  });

  it('indexes a Kenyan phone in all three forms a parent might say', () => {
    expect(phoneForms('+254712345678')).toEqual(['254712345678', '0712345678', '712345678']);
    expect(phoneForms('+447700900123')).toEqual(['447700900123']);
    expect(phoneForms(undefined)).toEqual([]);
  });
});

describe('query parsing', () => {
  it('caps length and token count', () => {
    const long = 'a'.repeat(MAX_QUERY_LENGTH + 50);
    expect(parseQuery(long).text.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
    const many = Array.from({ length: 30 }, (_, i) => `w${i}x`).join(' ');
    expect(parseQuery(many).tokens.length).toBe(MAX_TOKENS);
  });

  it('expands class abbreviations to the class they mean', () => {
    expect(parseQuery('f3').classPhrases).toEqual(['form 3']);
    expect(parseQuery('Form3 amina').classPhrases).toEqual(['form 3']);
    expect(parseQuery('g10').classPhrases).toEqual(['grade 10']);
    expect(parseQuery('gr10').classPhrases).toEqual(['grade 10']);
    expect(parseQuery('grade10').classPhrases).toEqual(['grade 10']);
  });
});

// ---------------------------------------------------------------------------
describe('search', () => {
  it('an empty query returns everyone, newest registration first (today\'s order)', () => {
    const out = run(roster());
    expect(out.total).toBe(7);
    expect(names(out)[0]).toBe('Mercy Wambui');
    expect(names(out).at(-1)).toBe('Kevin Mutua');
  });

  it('matches a name prefix, ignoring case and accents', () => {
    expect(names(run(roster(), { q: 'zoe' }))).toEqual(['Zoë Achieng']);
    expect(names(run(roster(), { q: 'ZOË' }))).toEqual(['Zoë Achieng']);
    expect(names(run(roster(), { q: 'obrien' }))).toEqual(["Sean O'Brien"]);
    expect(names(run(roster(), { q: "o'bri" }))).toEqual(["Sean O'Brien"]);
  });

  it('matches inside a name, not only at the start', () => {
    expect(names(run(roster(), { q: 'anjir' }))).toEqual(['Amina Wanjiru']);
  });

  it('every word must match (AND)', () => {
    expect(names(run(roster(), { q: 'amina chebet' }))).toEqual(['Amina Chebet']);
    expect(names(run(roster(), { q: 'amina nobody' }))).toEqual([]);
  });

  it('finds a phone number in any form a parent gives it', () => {
    for (const q of ['0722333444', '722333444', '+254722333444', '254722 333 444', '333444']) {
      expect(names(run(roster(), { q })), q).toEqual(['Brian Otieno']);
    }
  });

  it('a class typed into the box is a class requirement, not loose text', () => {
    // "3" alone would match inside nearly every M-Pesa receipt.
    expect(names(run(roster(), { q: 'amina form 3' }))).toEqual(['Amina Wanjiru']);
    expect(names(run(roster(), { q: 'amina f3' }))).toEqual(['Amina Wanjiru']);
    expect(names(run(roster(), { q: 'g10' })).sort()).toEqual(['Amina Chebet', "Sean O'Brien"]);
    expect(names(run(roster(), { q: 'form 3' })).sort()).toEqual(['Amina Wanjiru', 'Brian Otieno']);
  });

  it('matches subjects, including common short forms', () => {
    expect(names(run(roster(), { q: 'chemistry' }))).toEqual(['Brian Otieno']);
    expect(names(run(roster(), { q: 'chem' }))).toEqual(['Brian Otieno']);
    expect(names(run(roster(), { q: 'csl' }))).toEqual(["Sean O'Brien"]);
    // Mercy and Kevin carry the fixture's default 'English, Mathematics'.
    expect(names(run(roster(), { q: 'maths' })).sort()).toEqual(['Amina Chebet', 'Amina Wanjiru', 'Brian Otieno', 'Kevin Mutua', 'Mercy Wambui']);
  });

  it('matches receipt text, but only for words of 4+ characters', () => {
    expect(names(run(roster(), { q: 'qab1xyz9' }))).toEqual(['Amina Wanjiru']);
    // Short fragments ("1", "ksh") must not pull in every receipt.
    expect(run(roster(), { q: 'zoe ksh' }).total).toBe(0);
  });

  it('tolerates a typo in a name (4+ letters), but not wild guesses', () => {
    expect(names(run(roster(), { q: 'amnia wanjiru' }))).toEqual(['Amina Wanjiru']);
    expect(names(run(roster(), { q: 'wanjiku' }))).toEqual(['Amina Wanjiru']);
    expect(run(roster(), { q: 'zzzzzz' }).total).toBe(0);
    // Under 4 letters: no typo matching ("amx" is not "amina").
    expect(run(roster(), { q: 'amx' }).total).toBe(0);
  });

  it('ranks the best name match first', () => {
    const out = run(roster(), { q: 'amina' });
    expect(names(out)).toHaveLength(2);
    const exact = run(roster(), { q: 'amina chebet' });
    expect(names(exact)[0]).toBe('Amina Chebet');
    // A name hit outranks a subject hit for the same word.
    const mixed = [
      student({ studentName: 'Biology Fan', subjects: 'English', registeredAt: at('2026-01-01T00:00:00Z') }),
      student({ studentName: 'Someone Else', subjects: 'Biology', registeredAt: at('2026-12-01T00:00:00Z') }),
    ];
    expect(names(run(mixed, { q: 'biology' }))[0]).toBe('Biology Fan');
  });
});

// ---------------------------------------------------------------------------
describe('filters', () => {
  it('class chips: OR within the group, matched case-insensitively', () => {
    expect(names(run(roster(), { classes: ['Grade 7', 'grade 10'] })).sort())
      .toEqual(['Amina Chebet', "Sean O'Brien", 'Zoë Achieng']);
  });

  it('status definitions, including the production "receipt pending" trap', () => {
    // 98 of 99 production students have receiptStatus 'pending' from
    // registration alone; only a submitted receipt is "to review".
    expect(names(run(roster(), { statuses: ['review'] }))).toEqual(['Brian Otieno']);
    expect(names(run(roster(), { statuses: ['owes'] }))).toEqual(["Sean O'Brien"]);
    expect(names(run(roster(), { statuses: ['blocked'] }))).toEqual(['Zoë Achieng']);
    expect(names(run(roster(), { statuses: ['awaiting'] }))).toEqual(['Mercy Wambui']);
    expect(names(run(roster(), { statuses: ['rejected'] }))).toEqual(['Kevin Mutua']);
    expect(names(run(roster(), { statuses: ['owes', 'blocked'] })).sort()).toEqual(["Sean O'Brien", 'Zoë Achieng']);
    expect(STATUS_KEYS).toEqual(['review', 'owes', 'blocked', 'awaiting', 'rejected']);
  });

  it('a legacy student with no approvalStatus is approved, never "awaiting"', () => {
    const legacy = student({ approvalStatus: undefined });
    expect(run([legacy], { statuses: ['awaiting'] }).total).toBe(0);
  });

  it('subject filter, case-insensitive, OR within the group', () => {
    expect(names(run(roster(), { subjects: ['biology'] })).sort()).toEqual(['Amina Chebet', 'Amina Wanjiru']);
    expect(names(run(roster(), { subjects: ['Physics', 'Chemistry'] })).sort()).toEqual(['Brian Otieno', "Sean O'Brien"]);
  });

  it('AND across groups and with the query', () => {
    expect(names(run(roster(), { classes: ['Form 3'], subjects: ['Biology'] }))).toEqual(['Amina Wanjiru']);
    expect(names(run(roster(), { q: 'amina', classes: ['Grade 10'] }))).toEqual(['Amina Chebet']);
  });

  it('registered dates use Nairobi day boundaries', () => {
    // Zoë registered 23:30 EAT on 4 Oct (20:30 UTC): 4 Oct in Nairobi.
    expect(names(run(roster(), { from: '2026-10-04', to: '2026-10-04' }))).toEqual(['Zoë Achieng']);
    expect(names(run(roster(), { from: '2026-10-05' })).sort()).toEqual(['Amina Chebet', 'Amina Wanjiru', 'Mercy Wambui']);
    expect(names(run(roster(), { to: '2026-09-30' }))).toEqual(['Kevin Mutua']);
  });

  it('ignores malformed filter values instead of matching nothing', () => {
    expect(run(roster(), { from: 'not-a-date', statuses: ['nonsense'], sort: 'bogus' }).total).toBe(7);
  });
});

// ---------------------------------------------------------------------------
describe('sorting', () => {
  it('every sort, with a stable tie-break', () => {
    expect(SORTS).toEqual(['newest', 'oldest', 'name', 'name-desc', 'class', 'balance']);
    expect(names(run(roster(), { sort: 'oldest' }))[0]).toBe('Kevin Mutua');
    expect(names(run(roster(), { sort: 'name' })).slice(0, 2)).toEqual(['Amina Chebet', 'Amina Wanjiru']);
    expect(names(run(roster(), { sort: 'name-desc' }))[0]).toBe('Zoë Achieng');
    expect(names(run(roster(), { sort: 'balance' }))[0]).toBe("Sean O'Brien");
    const byClass = run(roster(), { sort: 'class' }, { classOrder: ['Grade 7', 'Grade 8', 'Grade 10', 'Form 3'] });
    expect(byClass.results.map((s) => s.class)).toEqual(['Grade 7', 'Grade 8', 'Grade 8', 'Grade 10', 'Grade 10', 'Form 3', 'Form 3']);
    // Same class: by name.
    expect(names(byClass).slice(1, 3)).toEqual(['Kevin Mutua', 'Mercy Wambui']);
  });

  it('identical keys fall back to the document id, so the order never flickers', () => {
    const a = student({ id: '+254700000002', studentName: 'Same Name', registeredAt: at('2026-01-01T00:00:00Z') });
    const b = student({ id: '+254700000001', studentName: 'Same Name', registeredAt: at('2026-01-01T00:00:00Z') });
    expect(run([a, b], { sort: 'name' }).results.map((s) => s.id)).toEqual(['+254700000001', '+254700000002']);
    expect(run([a, b], { q: 'same' }).results.map((s) => s.id)).toEqual(['+254700000001', '+254700000002']);
  });
});

// ---------------------------------------------------------------------------
describe('facet counts', () => {
  it('each group counts as if its own selection were cleared', () => {
    const out = run(roster(), { classes: ['Form 3'], statuses: ['review'] });
    // Class counts ignore the class selection but respect the status filter.
    expect(out.facets.class).toEqual({ 'form 3': 1 });
    // Status counts ignore the status selection but respect the class filter.
    expect(out.facets.status).toEqual({ review: 1, owes: 0, blocked: 0, awaiting: 0, rejected: 0 });
    // Subject counts respect both.
    expect(out.facets.subject.chemistry).toBe(1);
    expect(out.facets.subject.biology).toBeUndefined();
  });

  it('counts respect the query', () => {
    const out = run(roster(), { q: 'amina' });
    expect(out.facets.class).toEqual({ 'form 3': 1, 'grade 10': 1 });
  });
});

describe('option lists', () => {
  const sessionDoc = {
    id: 'morning',
    classes: ['Grade 7', 'Grade 8', 'Grade 10', 'Form 3'],
    subjectsByClass: { 'Form 3': [{ name: 'English', compulsory: true }, { name: 'Biology' }] },
  };

  it('classes: the session\'s order, then any class found only on students (marked)', () => {
    const index = buildIndex([...roster(), student({ class: 'Adult Class' })]);
    expect(classOptions([sessionDoc], index)).toEqual([
      { value: 'grade 7', label: 'Grade 7', offList: false },
      { value: 'grade 8', label: 'Grade 8', offList: false },
      { value: 'grade 10', label: 'Grade 10', offList: false },
      { value: 'form 3', label: 'Form 3', offList: false },
      { value: 'adult class', label: 'Adult Class', offList: true },
    ]);
  });

  it('subjects follow the selected classes (lists first, then subjects found on students)', () => {
    const index = buildIndex(roster());
    const form3 = subjectOptions([sessionDoc], ['Form 3'], index).map((o) => o.label);
    expect(form3.slice(0, 2)).toEqual(['English', 'Biology']);
    expect(form3).toContain('Chemistry'); // on Brian, a Form 3 student
    expect(form3).not.toContain('Physics'); // only on a Grade 10 student
    const all = subjectOptions([sessionDoc], [], index).map((o) => o.label);
    expect(all).toContain('Physics');
    expect(new Set(all.map((l) => l.toLowerCase())).size).toBe(all.length);
  });
});

describe('did you mean', () => {
  it('suggests the closest name when nothing matches', () => {
    expect(didYouMean('amnia wnajiru', buildIndex(roster()))).toBe('Amina Wanjiru');
    expect(didYouMean('xqzv', buildIndex(roster()))).toBeNull();
    expect(didYouMean('', buildIndex(roster()))).toBeNull();
  });
});

describe('robustness', () => {
  it('a malformed student document is indexed safely, never thrown on', () => {
    const odd = [
      { id: '+254700000009' },
      { id: '+254700000010', studentName: 42, subjects: ['Maths', null], class: null, registeredAt: 'garbage' },
      null,
      student({ studentName: 'Normal Kid' }),
    ];
    const out = run(odd, { q: 'normal' });
    expect(names(out)).toEqual(['Normal Kid']);
    expect(run(odd).total).toBe(3);
  });

  it('caches the index per snapshot array (rebuilt only when data changes)', () => {
    const list = roster();
    expect(buildIndex(list)).toBe(buildIndex(list));
    expect(buildIndex([...list])).not.toBe(buildIndex(list));
  });

  it('tags records with their session when asked (for the all-sessions view)', () => {
    const index = buildIndex(roster(), 'evening');
    expect(index.records.every((r) => r.session === 'evening')).toBe(true);
  });

  it('falls back to a plain name match if building the index fails', async () => {
    const logger = (await import('@utils/logger')).default;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const poisoned = roster();
    // Iterating the roster itself throws: the index cannot be built at all.
    Object.defineProperty(poisoned, Symbol.iterator, { value: () => { throw new Error('boom'); } });
    const out = searchStudents(buildIndex(poisoned), { ...DEFAULT_SEARCH_STATE, q: 'zoë' });
    expect(names(out)).toEqual(['Zoë Achieng']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
