/**
 * Analytics events — Phase 13 / 08 A2.
 *
 * This used to re-export from `@services/firebase/analytics`, which pulled the
 * Firebase app and `firebase/analytics` into every page that tracks an event —
 * including the student registration page — even with analytics switched OFF.
 *
 * Now each call is a no-op unless VITE_ENABLE_ANALYTICS is 'true', and only
 * then is the Firebase analytics module loaded, on first use. Event names and
 * parameters are unchanged (PII-free, Phase 01 D3).
 */

const enabled = import.meta.env.VITE_ENABLE_ANALYTICS === 'true';
let loader = null;

function send(fnName, ...args) {
  if (!enabled) return;
  loader ??= import('@services/firebase/analytics');
  loader.then((mod) => mod[fnName]?.(...args)).catch(() => {
    // Analytics is best-effort; a blocked script must not surface anywhere.
  });
}

export const logEvent = (eventName, params) => send('logEvent', eventName, params);
export const trackRegistration = (session) => send('trackRegistration', session);
export const trackLogin = () => send('trackLogin');
export const trackZoomRedirect = (session) => send('trackZoomRedirect', session);
export const trackStudentDelete = (session) => send('trackStudentDelete', session);
export const trackCSVExport = (session, count) => send('trackCSVExport', session, count);
export const trackPageView = (pageName) => send('trackPageView', pageName);
