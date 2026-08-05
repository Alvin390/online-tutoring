import { apiPost } from './client';

/**
 * Calendar calls — Phase 07.
 *
 * Reads go through the API rather than Firestore because a student's visible
 * scope depends on their own registration, which a security rule cannot
 * evaluate for an unauthenticated caller. Writes go through it because "this
 * and future occurrences" splits a series into two documents, which a client
 * cannot do atomically.
 */

export const getCalendarEvents = ({ from, to, session, phone }) =>
  apiPost('/api/calendar/events', {
    from,
    to,
    ...(session ? { session } : {}),
    ...(phone ? { phone } : {}),
  });

export const manageCalendarEvent = (payload) => apiPost('/api/calendar/manage', payload);

export const issueCalendarFeed = ({ role, session, phone }) =>
  apiPost('/api/calendar/feedToken', { action: 'issue', role, session, phone });

export const revokeCalendarFeed = ({ token, tokenId }) =>
  apiPost('/api/calendar/feedToken', { action: 'revoke', token, tokenId });

export const listCalendarFeeds = () => apiPost('/api/calendar/feedToken', { action: 'list' });
