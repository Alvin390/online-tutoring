import { redactSentryEvent, redactString, redact } from './redact';
import { releaseName } from './releaseName';

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

/**
 * A coarse page name for tagging — Phase 13 / 08 D2. Low cardinality on
 * purpose: every class page is one value, never its slug or a student's
 * number, so dashboards can group by page and nothing identifying leaves.
 */
const STATIC_ROUTES = {
  '/': 'home', '/login': 'login', '/dashboard': 'dashboard', '/billing': 'billing',
  '/superadmin': 'superadmin', '/403': 'forbidden', '/404': 'not-found',
};
export function routeTag(pathname = '/') {
  const path = (pathname.replace(/\/+$/, '') || '/').toLowerCase();
  return STATIC_ROUTES[path] ?? (/^\/[a-z0-9-]+$/.test(path) ? 'session-page' : 'other');
}

/**
 * The release name — 002Fixes / 01. Every build used to report
 * `online-tutoring@2.0.0`, so Sentry could not say which deploy an error came
 * from. The commit is baked in at build time (vite.config.js: Workers Builds'
 * WORKERS_CI_COMMIT_SHA, else local git), giving `online-tutoring@2.0.0+5dd6570`.
 * Shared with the source-map upload (002Fixes / 10) so the two always match.
 */
export { releaseName };

/**
 * API failures grouped by WHAT failed — 002Fixes / 01.
 *
 * Without source maps every ApiError has the same minified top frame, so
 * Sentry put timeouts, 429s and empty-phone 400s into one issue whose title
 * was whichever came first (26 Oct: 1-1 and 1-2). Fingerprinting on endpoint
 * and code gives each its own issue; the tags let them be filtered. Values are
 * paths and codes, never anything a student typed.
 */
export function groupApiError(event, hint) {
  const error = hint?.originalException;
  if (!event || error?.name !== 'ApiError') return event;
  const path = error.path || 'unknown';
  const code = error.code || 'unknown';
  return {
    ...event,
    fingerprint: ['api-error', path, code],
    tags: { ...(event.tags ?? {}), api_path: path, api_code: code, api_status: String(error.status ?? 0) },
  };
}

/** Everything an error event goes through on its way out. */
export function prepareEvent(event, hint) {
  const tagged = { ...event, tags: { ...(event?.tags ?? {}), route: routeTag(window.location.pathname) } };
  return redactSentryEvent(groupApiError(tagged, hint), hint);
}

export async function initMonitoring() {
  if (!import.meta.env.PROD || !import.meta.env.VITE_SENTRY_DSN) return null;

  const Sentry = await import('@sentry/react');

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Release tracking, per commit (002Fixes / 01).
    release: releaseName(import.meta.env.VITE_APP_VERSION, import.meta.env.VITE_APP_COMMIT),
    // Which Workers Builds branch made this build: a preview and master are
    // told apart without Sentry's `dist`, which source-map uploads must match.
    initialScope: { tags: { build_branch: import.meta.env.VITE_APP_BRANCH || 'local' } },

    integrations: [
      // Console output as structured logs.
      Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),

      // Distributed tracing. `tracesSampleRate` was already set but nothing
      // was collecting spans without this integration, so the number had no
      // effect.
      Sentry.browserTracingIntegration(),

      // Session replay, MASKED. This app puts student names, parent phone
      // numbers and fee balances on the screen; an unmasked replay would ship
      // all of it to a third party as video-like DOM data, which is exactly
      // what the redaction below exists to prevent. Masking is not optional
      // here, and it is what Sentry's own React guide recommends by default.
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],

    tracesSampleRate: 0.1,
    // Only our own API. Without this the tracing header is attached to every
    // cross-origin request, which both leaks that we use Sentry and trips CORS
    // on third parties that do not allow the header.
    tracePropagationTargets: [/^\//, window.location.origin],

    // 10% of ordinary sessions; every session that errors.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    enableLogs: true,

    // Phase 01 D3 redaction, applied on the way out — plus the page the error
    // happened on (Phase 13 / 08 D2), read at send time so no router wiring
    // is needed, and API failures grouped by endpoint and code (002Fixes / 01).
    beforeSend: prepareEvent,
    sendDefaultPii: false,

    /**
     * Logs go through their OWN pipeline — `beforeSend` never sees them. Without
     * this, turning on console logging would quietly become the widest PII leak
     * in the app: the logger prints phone numbers, receipt references and error
     * payloads, and all of it would reach Sentry unredacted while `beforeSend`
     * dutifully cleaned the error events next to it.
     */
    beforeSendLog: (log) => {
      try {
        return {
          ...log,
          message: typeof log.message === 'string' ? redactString(log.message) : log.message,
          attributes: log.attributes ? redact(log.attributes) : log.attributes,
        };
      } catch {
        // A redaction failure must drop the log, never send it raw.
        return null;
      }
    },

    // Console breadcrumbs stay OFF. They are attached to error events, are not
    // covered by beforeSendLog, and now duplicate what the logging integration
    // sends properly. Dropping them loses nothing and closes a second path.
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
 * A failure the student screens HANDLED — 002Fixes / 01.
 *
 * Until now check-in failures reached Sentry only because nothing caught them
 * (unhandled rejections). Once the screens catch them, this is how they keep
 * being seen: an API failure at warning level (the network and the limits are
 * expected to misbehave sometimes), anything else at error level (a bug).
 * `action` and `screen` are fixed words chosen by the caller.
 */
export function reportApiFailure(error, { action = 'unknown', screen = 'unknown' } = {}) {
  if (!sentryRef || !error) return;
  sentryRef.captureException(error, {
    level: error.name === 'ApiError' ? 'warning' : 'error',
    tags: { flow_action: action, flow_screen: screen },
  });
}

/**
 * A step in the student check-in flow, as a breadcrumb — 002Fixes / 01. The
 * next error then shows the path that led to it. Data must be lengths, flags
 * and fixed words: it is redacted on the way out, but nothing identifying
 * should be put in in the first place.
 */
export function addFlowBreadcrumb(message, data) {
  sentryRef?.addBreadcrumb?.({ category: 'checkin.flow', level: 'info', message, data });
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
  observeLongTasks();
}

/**
 * Long tasks — Phase 13 / 08 D2. Any main-thread task over 200 ms (the
 * point at which a tap visibly lags) becomes a breadcrumb with its page, so
 * an error or a slow-INP report shows what was blocking just before it.
 * Breadcrumbs, not events: they cost nothing unless something is reported.
 */
export function observeLongTasks(Observer = globalThis.PerformanceObserver) {
  if (!sentryRef || !Observer?.supportedEntryTypes?.includes?.('longtask')) return null;
  const observer = new Observer((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration < LONG_TASK_MS) continue;
      sentryRef.addBreadcrumb?.({
        category: 'perf.longtask',
        level: 'info',
        message: `Long task ${Math.round(entry.duration)} ms`,
        data: { ms: Math.round(entry.duration), route: routeTag(window.location.pathname) },
      });
    }
  });
  observer.observe({ type: 'longtask', buffered: true });
  return observer;
}

const LONG_TASK_MS = 200;

/** For tests. */
export function __setSentryForTest(sentry) {
  sentryRef = sentry;
}
