import { describe, it, expect } from 'vitest';
import * as client from '@shared/constants/subjects';
import * as server from '../../../api/_lib/subjects.js';

/**
 * Phase 14: the subject defaults and rules exist twice — the browser module
 * (registration form, session editor, edit student) and the server module
 * that enforces them. They must agree exactly.
 */

describe('client and server agree', () => {
  it('defaults and limits are identical', () => {
    expect(JSON.parse(JSON.stringify(client.DEFAULT_SUBJECTS_BY_CLASS)))
      .toEqual(JSON.parse(JSON.stringify(server.DEFAULT_SUBJECTS_BY_CLASS)));
    for (const k of ['MAX_SUBJECTS', 'MAX_SUBJECT_NAME', 'MAX_SUBJECTS_TEXT']) expect(client[k]).toBe(server[k]);
  });

  const cases = [
    [[{ name: 'English', compulsory: true }, { name: 'Biology' }], ['english', 'Biology']],
    [[{ name: 'English', compulsory: true }, { name: 'Biology' }], ['Biology']],
    [[{ name: 'English' }], ['Physics']],
    [[{ name: 'English' }], []],
    [[], 'Bookkeeping, typing'],
    [[{ name: 'A' }, { name: 'B' }], 'b, a'],
  ];
  it('checkSubjectChoice gives the same verdicts', () => {
    for (const [options, chosen] of cases) {
      expect(client.checkSubjectChoice(options, chosen, 'Form 3')).toEqual(server.checkSubjectChoice(options, chosen, 'Form 3'));
    }
  });
});

describe('subject rules', () => {
  const { DEFAULT_SUBJECTS_BY_CLASS, subjectsForClass, checkSubjectChoice, parseSubjects } = client;

  it('defaults: Grade 7 and 8 share nine subjects, Grade 10 has CSL in full, only Form 3 has compulsory subjects', () => {
    expect(DEFAULT_SUBJECTS_BY_CLASS['Grade 7'].map((s) => s.name)).toHaveLength(9);
    expect(DEFAULT_SUBJECTS_BY_CLASS['Grade 8']).toEqual(DEFAULT_SUBJECTS_BY_CLASS['Grade 7']);
    expect(DEFAULT_SUBJECTS_BY_CLASS['Grade 10'].map((s) => s.name)).toContain('Community Service Learning (CSL)');
    const withCompulsory = Object.entries(DEFAULT_SUBJECTS_BY_CLASS)
      .filter(([, list]) => list.some((s) => s.compulsory)).map(([cls]) => cls);
    expect(withCompulsory).toEqual(['Form 3']);
    expect(DEFAULT_SUBJECTS_BY_CLASS['Form 3'].every((s) => s.compulsory)).toBe(true);
  });

  it('subjectsForClass: the session\'s entry wins (even empty), otherwise defaults by name, otherwise none', () => {
    const session = { subjectsByClass: { 'Grade 10': [{ name: 'Physics' }], 'Grade 7': [] } };
    expect(subjectsForClass(session, 'Grade 10')).toEqual([{ name: 'Physics', compulsory: false }]);
    expect(subjectsForClass(session, 'Grade 7')).toEqual([]);
    expect(subjectsForClass(session, 'Form 3').map((s) => s.name)).toEqual(['English', 'Kiswahili', 'Mathematics']);
    expect(subjectsForClass(null, 'Adult Class')).toEqual([]);
  });

  it('parseSubjects reads arrays and comma text alike', () => {
    expect(parseSubjects(' English ,  Kiswahili,,')).toEqual(['English', 'Kiswahili']);
    expect(parseSubjects(['  Social   Studies '])).toEqual(['Social Studies']);
  });

  it('checkSubjectChoice: list spelling and order, compulsory named, unknown refused', () => {
    const form3 = [...DEFAULT_SUBJECTS_BY_CLASS['Form 3'], { name: 'Biology', compulsory: false }];
    expect(checkSubjectChoice(form3, ['biology', 'MATHEMATICS', 'english', 'kiswahili'], 'Form 3'))
      .toEqual({ ok: true, text: 'English, Kiswahili, Mathematics, Biology' });
    expect(checkSubjectChoice(form3, ['Biology'], 'Form 3'))
      .toEqual({ ok: false, message: 'English, Kiswahili and Mathematics are compulsory for Form 3.' });
    expect(checkSubjectChoice(form3, ['English', 'Kiswahili', 'Mathematics', 'Art'], 'Form 3').ok).toBe(false);
    expect(checkSubjectChoice([], 'Anything goes', 'Adult').text).toBe('Anything goes');
  });
});
