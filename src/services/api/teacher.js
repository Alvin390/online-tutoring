import { apiPost } from './client';

/**
 * Teacher-side serverless calls — Phase 04.
 */

/**
 * Saves a class link. The server re-validates with its own copy of
 * parseClassLink and stores the re-serialised URL, so what is stored is
 * exactly what was validated.
 */
export const setClassLink = (session, url) => apiPost('/api/class/setLink', { session, url });

/**
 * Approve or reject registrations. Takes an array so single and bulk share one
 * code path — and so a bulk decision is one transaction-per-student inside one
 * request rather than N independent client writes that can half-fail.
 */
export const decideApproval = (session, decision, phones, reason) =>
  apiPost('/api/student/approve', {
    session,
    decision,
    phones,
    ...(reason ? { reason } : {}),
  });
