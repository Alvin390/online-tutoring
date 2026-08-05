import { apiPost } from './client';

/**
 * Session management calls — Phase 05.
 *
 * All go through one endpoint with an `action`, because they share the same
 * authorization and the same audit shape, and because create/delete need
 * server-side logic (slug reservation, recursive delete, student reassignment)
 * that a direct Firestore write cannot express.
 */
export const manageSession = (payload) => apiPost('/api/sessions/manage', payload);

/**
 * Deletes a student AND their notes subcollection.
 *
 * Firestore does not cascade — a plain deleteDoc leaves every private note
 * intact and orphaned, still readable by anyone with the path.
 */
export const removeStudent = (session, phone) =>
  apiPost('/api/student/remove', { session, phone });
