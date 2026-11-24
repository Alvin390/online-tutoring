/**
 * Every word of the admission-number steps — 014Fixes (owner, 2026-11-24).
 * The approved wording is issues/014Fixes/plan/copy.md; change it there and
 * here together. `{session}` is the session's name ("Evening").
 *
 * The first screen's one-device note lives in CheckinCard (every student
 * loads it); everything here is in the lazy admission-number chunk.
 */

export const NUMBER_STEP = Object.freeze({
  title: 'Type your admission number',
  forSession: (session) => `for ${session} class`,
  change: 'Change',
  label: 'Admission number',
  placeholder: 'e.g. 4071 (staff: S-4071)',
  button: 'Check in',
  checking: 'Checking…',
  forgotLink: 'Forgot your admission number?',
  forgotTitle: 'You already have an admission number',
  forgotBody: (session) => `You have an admission number for ${session} class. Ask your teacher for it, then come back and check in.`,
  ok: 'OK',
  // The server's own words for these (api/student/checkin.js), kept in step.
  mismatch: "That admission number and phone don't match. Check both, or ask your teacher.",
  shape: 'Enter your 4-digit admission number (staff: S- and 4 digits).',
});
