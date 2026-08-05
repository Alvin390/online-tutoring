import { apiPost } from './client';

/**
 * Student-facing operations — Phase 01.
 *
 * These used to be direct Firestore calls. They moved server-side when student
 * documents stopped being world-readable: an unauthenticated visitor has no
 * credential a security rule can evaluate, so the check has to happen somewhere
 * that can hold one.
 */

export const checkinStudent = (session, phone) =>
  apiPost('/api/student/checkin', { session, phone });

export const submitReceipt = (session, phone, receiptMessage) =>
  apiPost('/api/student/receipt', { session, phone, receiptMessage });

/**
 * Requests the class link. Throws ApiError with a `code` of 'blocked',
 * 'approval_pending', 'registration_rejected' or 'service_unavailable' when the
 * caller is not entitled to it — the reason is decided on the server, and the
 * UI renders whatever it is told.
 */
export const getClassLink = (session, phone) =>
  apiPost('/api/class/link', { session, phone });

/**
 * Resubmits corrected details after a rejection — Phase 04.
 *
 * Server-side because firestore.rules deliberately never lets a student write
 * `approvalStatus`, including back to 'pending', and because the 3-strikes soft
 * block has to be enforced somewhere the student cannot reach.
 */
export const resubmitRegistration = (session, phone, details) =>
  apiPost('/api/student/resubmit', { session, phone, ...details });
