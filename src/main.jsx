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

// Monitoring — Phase 01 D3 redaction plus Phase 11 D2 release/tag context.
// Dynamically imported so neither Sentry nor web-vitals enters the dev bundle.
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  import('./shared/utils/monitoring').then(async ({ initMonitoring, reportWebVitals }) => {
    await initMonitoring();
    reportWebVitals();
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
