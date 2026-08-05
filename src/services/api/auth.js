import { apiPost } from './client';

/**
 * Auth-related serverless calls — Phase 02.
 */

/**
 * Records a sign-in outcome for the brute-force counter.
 *
 * Deliberately swallows its own errors at the call site: a lockout counter that
 * can break sign-in is worse than no lockout counter. It is a supplement to
 * Firebase's own throttling, not a replacement for it.
 */
export const recordLoginAttempt = (email, outcome) =>
  apiPost('/api/auth/loginAttempt', { email, outcome });

export const requestStudentCode = (session, phone) =>
  apiPost('/api/student/requestCode', { session, phone });

export const verifyStudentCode = (session, phone, code) =>
  apiPost('/api/student/verifyCode', { session, phone, code });

export const setUserRole = (payload) => apiPost('/api/admin/setRole', payload);
