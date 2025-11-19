import { logEvent as firebaseLogEvent } from 'firebase/analytics';
import { analytics } from './config';

export const logEvent = (eventName, params = {}) => {
  if (!analytics || import.meta.env.VITE_ENABLE_ANALYTICS !== 'true') {
    console.log(`📊 Analytics (disabled): ${eventName}`, params);
    return;
  }

  try {
    firebaseLogEvent(analytics, eventName, params);
    console.log(`📊 Analytics event: ${eventName}`, params);
  } catch (error) {
    console.warn('❌ Analytics event failed:', error);
  }
};

// Predefined events matching original app
export const trackRegistration = (session, phoneNumber) => {
  logEvent('registration_completed', { session, phoneNumber });
};

export const trackLogin = (email) => {
  logEvent('teacher_login', { email });
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
