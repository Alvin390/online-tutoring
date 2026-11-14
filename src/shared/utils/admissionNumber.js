/**
 * Admission and staff numbers — 008Fixes / 02 (owner, 2026-11-14).
 *
 * Every registration chooses a 4-digit number, unique within its session.
 * Students hold an admission number ("0042"); staff hold a staff number,
 * written "S-0042". Leading zeros are kept, so a number is always a STRING.
 * Numbers that are too easy to guess are refused, with the reason.
 *
 * PARITY: api/_lib/admissionNumber.js is a copy for the API build (no Vite
 * aliases). tests/unit/fixes008/admissionNumberRule.test.js asserts the two
 * agree on all 10,000 numbers. Change both or neither.
 */

export const NUMBER_DIGITS = 4;
export const EASY_NUMBER_MESSAGE = "That number is too easy to guess. Choose one that isn't a pattern.";
export const NUMBER_FORMAT_MESSAGE = 'Enter exactly 4 digits, for example 4071.';

const FOUR_DIGITS = /^\d{4}$/;

/**
 * Why a 4-digit number can't be used, or null when it can.
 * 'format': not exactly 4 digits. 'easy': all the same (1111), a straight run
 * up or down (1234, 9876), or a two-digit repeat (1212, 0101).
 */
export function numberProblem(digits) {
  const value = String(digits ?? '');
  if (!FOUR_DIGITS.test(value)) return 'format';
  const d = [...value].map(Number);
  if (d.every((x) => x === d[0])) return 'easy';
  const steps = [d[1] - d[0], d[2] - d[1], d[3] - d[2]];
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return 'easy';
  if (value[0] === value[2] && value[1] === value[3]) return 'easy';
  return null;
}

/** The message for a numberProblem() answer. */
export const numberProblemMessage = (problem) =>
  (problem === 'easy' ? EASY_NUMBER_MESSAGE : problem === 'format' ? NUMBER_FORMAT_MESSAGE : '');

/**
 * What a student typed into the number field: "0042" is an admission number;
 * "S-0042", "s0042" and "S 0042" are a staff number. Spaces around are
 * ignored. Returns { kind: 'student' | 'staff', digits } or null.
 */
export function parseNumberInput(raw) {
  const match = /^(s[\s-]?)?(\d{4})$/i.exec(String(raw ?? '').trim());
  if (!match) return null;
  return { kind: match[1] ? 'staff' : 'student', digits: match[2] };
}

/** How a number is shown: "0042" for a student, "S-0042" for staff. */
export const formatNumber = (kind, digits) => (kind === 'staff' ? `S-${digits}` : String(digits));

/** The reservation document id: one collection per session, "A0042" / "S0042". */
export const reservationId = (kind, digits) => `${kind === 'staff' ? 'S' : 'A'}${digits}`;

/** The number a record holds: { kind, digits } or null (staff hold staffNumber). */
export function recordNumber(record) {
  if (!record) return null;
  if (record.staff === true) return record.staffNumber ? { kind: 'staff', digits: record.staffNumber } : null;
  return record.admissionNumber ? { kind: 'student', digits: record.admissionNumber } : null;
}
