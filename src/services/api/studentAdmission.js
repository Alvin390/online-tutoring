import { apiPost } from './client';

/**
 * The class-time wait (student.js CLASS_TIME_TIMEOUT_MS, 007Fixes / 01). A
 * copy, not an import: importing student.js from here split it into its own
 * chunk on /:slug (+0.2 KB). tests/unit/fixes008/studentCheckinFlow.test.jsx
 * keeps the two equal.
 */
export const CLASS_TIME_TIMEOUT_MS = 20_000;

/**
 * 008Fixes / 01-02: confirming the phone and choosing a number. The code goes
 * by SMS (or the teacher reads it out); a correct code returns a ticket that
 * choosing a number needs. Refusals arrive as ApiError with a `code`.
 *
 * Its own module so only the lazy first-time steps load it, never the
 * check-in form every student opens (the /:slug budget).
 */
// 009Fixes / 01: `purpose: 'register'` for code-first registration (a number with no record yet).
export const requestCode = (session, phone, purpose) =>
  apiPost('/api/student/requestCode', { session, phone, ...(purpose ? { purpose } : {}) }, { timeoutMs: CLASS_TIME_TIMEOUT_MS });

export const verifyCode = (session, phone, code, purpose) =>
  apiPost('/api/student/verifyCode', { session, phone, code, ...(purpose ? { purpose } : {}) }, { timeoutMs: CLASS_TIME_TIMEOUT_MS });

/**
 * 009Fixes / 02-03: fix my number, once, for a record never confirmed.
 * `who` is { oldPhone } or { studentName, class }; confirm adds { code }, or
 * { ticket } alone to finish a move that stopped half-way.
 */
export const fixNumberRequest = (session, newPhone, who) =>
  apiPost('/api/student/fixNumber', { action: 'request', session, newPhone, ...who }, { timeoutMs: CLASS_TIME_TIMEOUT_MS });

export const fixNumberConfirm = (session, newPhone, who, { code, ticket } = {}) =>
  apiPost('/api/student/fixNumber', {
    action: 'confirm', session, newPhone, ...(ticket ? {} : who), ...(code ? { code } : {}), ...(ticket ? { ticket } : {}),
  }, { timeoutMs: CLASS_TIME_TIMEOUT_MS });

/** Live check: { status: 'free' | 'taken' | 'easy' | 'format', message }. */
export const checkNumber = (session, number, kind, { signal } = {}) =>
  apiPost('/api/student/number', { action: 'check', session, number, ...(kind ? { kind } : {}) }, { signal });

export const chooseNumber = (session, phone, number, ticket) =>
  apiPost('/api/student/number', { action: 'choose', session, phone, number, ticket }, { timeoutMs: CLASS_TIME_TIMEOUT_MS });
