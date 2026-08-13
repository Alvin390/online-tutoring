import { logEvent as firebaseLogEvent } from 'firebase/analytics';
import { analytics } from './config';
import logger from '@utils/logger';

/**
 * Analytics events.
 *
 * Phase 01 D3: event parameters are PII-free. `trackRegistration` used to send
 * the parent's phone number and `trackLogin` the teacher's email address to
 * Google Analytics — a third-party sink outside our retention control, and a
 * harder leak to walk back than a console log. Neither identifier tells us
 * anything the aggregate count does not.
 */

export const logEvent = (eventName, params = {}) => {
  if (!analytics || import.meta.env.VITE_ENABLE_ANALYTICS !== 'true') {
    logger.debug('Analytics (disabled)', { eventName, params });
    return;
  }

  try {
    firebaseLogEvent(analytics, eventName, params);
    logger.debug('Analytics event', { eventName, params });
  } catch (error) {
    logger.warn('Analytics event failed', { error: error?.message });
  }
};

// Predefined events. Session names and counts only — never an identifier.
export const trackRegistration = (session) => {
  logEvent('registration_completed', { session });
};

export const trackLogin = () => {
  logEvent('teacher_login', {});
};

export const trackZoomRedirect = (session) => {
  logEvent('zoom_redirect', { session });
};

export const trackStudentDelete = (session) => {
  logEvent('student_deleted', { session });
};

export const trackCSVExport = (session, count) => {
  logEvent('csv_export', { session, studentCount: count });
};

export const trackPageView = (pageName) => {
  logEvent('page_view', { page_name: pageName });
};
