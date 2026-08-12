import { redactSentryEvent } from './redact';

/**
 * Sentry configuration — Phase 11 D2.
 *
 * Extends the minimal Phase 01 wiring (DSN, environment, trace sample rate)
 * with release tracking, tier/status tags and user context.
 *
 * THE RULE THAT GOVERNS ALL OF IT: user context carries **uid and role only**.
 * Never phone, never email, never a receipt body. An error report is a sink
 * that leaves our control, is retained on someone else's schedule, and is read
 * by whoever has a Sentry login — so it gets the same redaction as a log, plus
 * an explicit allowlist for the user object.
 */

let sentryRef = null;

export async function initMonitoring() {
  if (!import.meta.env.PROD || !import.meta.env.VITE_SENTRY_DSN) return null;

  const Sentry = await import('@sentry/react');

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Release tracking, so a stack trace maps to the source map CI uploaded.
    release: import.meta.env.VITE_APP_VERSION
      ? `online-tutoring@${import.meta.env.VITE_APP_VERSION}`
      : undefined,
    tracesSampleRate: 0.1,
    // Phase 01 D3 redaction, applied on the way out.
    beforeSend: redactSentryEvent,
    sendDefaultPii: false,
    // A breadcrumb trail can capture form values and URLs; redact those too.
    beforeBreadcrumb: (crumb) => {
      if (crumb.category === 'console') return null;
      return crumb;
    },
    ignoreErrors: [
      // Browser extension and network noise that is not actionable.
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      'Failed to fetch',
      'NetworkError',
      'AbortError',
    ],
  });

  sentryRef = Sentry;
  return Sentry;
}

/**
 * Attaches who is using the app, at the coarsest useful granularity.
 *
 * `uid` is an opaque Firebase identifier — it is not a phone number, an email
 * or a name, and it is the only identifier that goes. Role and tier ride as
 * tags so an error can be filtered to "Gold teachers" without identifying one.
 */
export function setMonitoringUser({ uid, role, tier, subscriptionStatus }) {
  if (!sentryRef) return;

  sentryRef.setUser(uid ? { id: uid } : null);
  sentryRef.setTag('role', role ?? 'anonymous');
  sentryRef.setTag('tier', tier ?? 'none');
  sentryRef.setTag('subscription_status', subscriptionStatus ?? 'unknown');
}

/** Records which flags were on, so a bug report is reproducible. */
export function setMonitoringFlags(flags) {
  if (!sentryRef || !flags) return;
  const enabled = Object.entries(flags)
    .filter(([, value]) => value === true)
    .map(([key]) => key);
  sentryRef.setTag('flags_enabled', enabled.join(',') || 'none');
}

/**
 * Reports an error from a money or access-control path at high severity.
 *
 * These are the alerts that should page rather than accumulate: a webhook that
 * cannot be verified, a ledger transaction that failed, a callback that did not
 * post. Everything else can wait for the daily review.
 */
export function captureCritical(message, error, context = {}) {
  if (!sentryRef) return;
  sentryRef.captureException(error ?? new Error(message), {
    level: 'fatal',
    tags: { critical_path: context.path ?? 'unknown' },
    extra: context,
  });
}

/**
 * Core Web Vitals to Sentry — Phase 10's real-user measurement.
 *
 * Loaded dynamically and only in production, so the `web-vitals` code never
 * enters the development bundle. Silently no-ops if the package is absent,
 * because vitals reporting must never be the reason the app fails to start.
 */
export async function reportWebVitals() {
  if (!import.meta.env.PROD || !sentryRef) return;

  try {
    const vitals = await import('web-vitals');
    const send = (metric) => {
      sentryRef.setMeasurement?.(metric.name, metric.value, metric.name === 'CLS' ? '' : 'millisecond');
    };
    vitals.onCLS?.(send);
    vitals.onLCP?.(send);
    vitals.onINP?.(send);
  } catch {
    // web-vitals is optional; absence is not an error.
  }
}
