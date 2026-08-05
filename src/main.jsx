import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import logger from './shared/utils/logger';

// Import styles
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/index.css';
import './styles/animations.css';
import './styles/dashboard.css';

// Initialize Sentry in production
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  Promise.all([
    import('@sentry/react'),
    import('./shared/utils/redact'),
  ]).then(([Sentry, { redactSentryEvent }]) => {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
      // Phase 01 D3. Error reports are the easiest PII leak to overlook,
      // because nobody reads them during development. Same redaction the
      // logger applies, on the way out.
      beforeSend: redactSentryEvent,
      sendDefaultPii: false,
    });
  });
}

// Register PWA service worker
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => {
        logger.info('PWA service worker registered');
      })
      .catch((error) => {
        logger.warn('PWA service worker registration failed', { error: error?.message });
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
