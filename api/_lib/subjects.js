/**
 * Subjects per class — Phase 14.
 *
 * Each session keeps an optional map `subjectsByClass`:
 *
 *   { "Form 3": [{ name: "English", compulsory: true }, ...], ... }
 *
 * Resolution for one class:
 *   - an entry in the map (even an empty list) is the teacher's choice
 *   - no entry: the defaults for that class NAME (DEFAULT_SUBJECTS_BY_CLASS)
 *   - an empty list (or an unknown class with no entry): no checkbox list —
 *     the registration form falls back to the free-text subjects box
 *
 * A student's choice is STORED as the same comma-separated text as before
 * ("English, Kiswahili, Mathematics"), so the dashboard, PDF export, message
 * templates and every existing student read it unchanged.
 *
 * Mirror of src/shared/constants/subjects.js (parity-tested).
 */

export const MAX_SUBJECTS = 30;
export const MAX_SUBJECT_NAME = 60;
export const MAX_SUBJECTS_TEXT = 500;

const subject = (name, compulsory = false) => Object.freeze({ name, compulsory });

const JUNIOR_SCHOOL = Object.freeze([
  subject('English'),
  subject('Kiswahili'),
  subject('Mathematics'),
  subject('Integrated Science'),
  subject('Social Studies'),
  subject('Religious Education'),
  subject('Pre-Technical Studies'),
  subject('Agriculture and Nutrition'),
  subject('Creative Arts and Sports'),
]);

export const DEFAULT_SUBJECTS_BY_CLASS = Object.freeze({
  'Grade 7': JUNIOR_SCHOOL,
  'Grade 8': JUNIOR_SCHOOL,
  'Grade 10': Object.freeze([
    subject('English'),
    subject('Kiswahili'),
    subject('Mathematics'),
    subject('Community Service Learning (CSL)'),
  ]),
  'Form 3': Object.freeze([
    subject('English', true),
    subject('Kiswahili', true),
    subject('Mathematics', true),
  ]),
});

const own = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);
const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/** The subject list a class offers in this session ([] = free text). */
export function subjectsForClass(sessionDoc, className) {
  const map = sessionDoc?.subjectsByClass;
  if (own(map, className) && Array.isArray(map[className])) {
    return map[className].map((s) => ({ name: s.name, compulsory: s.compulsory === true }));
  }
  return (DEFAULT_SUBJECTS_BY_CLASS[className] ?? []).map((s) => ({ ...s }));
}

/** `{ [class]: subjects[] }` for every class the session offers. */
export function resolveSubjectsByClass(sessionDoc, classes) {
  return Object.fromEntries(classes.map((c) => [c, subjectsForClass(sessionDoc, c)]));
}

/** A subjects value as a list: an array, or legacy comma-separated text. */
export function parseSubjects(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(',');
  return list.map(clean).filter(Boolean);
}

/** The stored form. */
export const joinSubjects = (list) => list.join(', ');

/**
 * Checks a student's choice against the class's options.
 *
 * With no options (free text) the choice is taken as written. Otherwise every
 * chosen subject must be on the list (matched ignoring case, stored with the
 * list's spelling and in the list's order), every compulsory subject must be
 * included, and at least one subject must be chosen.
 *
 * @returns {{ ok: true, text: string } | { ok: false, message: string }}
 */
export function checkSubjectChoice(options, chosenInput, className) {
  const chosen = parseSubjects(chosenInput);
  if (chosen.length === 0) return { ok: false, message: 'Please choose at least one subject.' };
  if (!options || options.length === 0) return { ok: true, text: joinSubjects(chosen) };

  const unknown = chosen.filter((c) => !options.some((o) => same(o.name, c)));
  if (unknown.length > 0) {
    return { ok: false, message: `"${unknown[0]}" is not a subject for ${className}. Please choose from the list.` };
  }
  const missing = options.filter((o) => o.compulsory && !chosen.some((c) => same(o.name, c))).map((o) => o.name);
  if (missing.length > 0) {
    const names = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`;
    return { ok: false, message: `${names} ${missing.length === 1 ? 'is' : 'are'} compulsory for ${className}.` };
  }
  const picked = options.filter((o) => chosen.some((c) => same(o.name, c))).map((o) => o.name);
  return { ok: true, text: joinSubjects(picked) };
}
