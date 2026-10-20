/**
 * Session slugs — Phase 05 Part A.
 *
 * The session's slug IS its document ID (`sessions/{slug}`). That gives
 * uniqueness for free — Firestore cannot hold two documents with the same ID —
 * and it means the existing `sessions/morning` and `sessions/evening`
 * documents are already correctly keyed. There is no migration.
 *
 * Slugs are also route segments, so they must not collide with an application
 * route. `/:sessionSlug` is matched after the static routes by React Router, so
 * a collision would not actually shadow `/dashboard` — but it would create a
 * session nobody can ever reach, which is worse than an error at creation time.
 */

export const RESERVED_SLUGS = Object.freeze([
  // Application routes
  'login',
  'logout',
  'dashboard',
  'billing',
  'superadmin',
  'admin',
  '403',
  '404',
  // Infrastructure
  'api',
  'assets',
  'static',
  'sw',
  'workbox',
  'manifest',
  'robots',
  'favicon',
  // Reserved for later phases
  'fees',
  'calendar',
  'whatsapp',
  'settings',
  'account',
  'help',
  // Phase 13 / 06 routes
  'reports',
  'support',
]);

export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

export const MAX_SESSION_NAME = 60;

/**
 * @returns {{valid: true, slug: string} | {valid: false, error: string}}
 */
export function validateSlug(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { valid: false, error: 'Please enter a web address for this session.' };
  }

  const slug = raw.trim().toLowerCase();

  if (!SLUG_PATTERN.test(slug)) {
    return {
      valid: false,
      error:
        'Use 1–40 lowercase letters, numbers and hyphens. It cannot start or end with a hyphen.',
    };
  }

  if (RESERVED_SLUGS.includes(slug)) {
    return { valid: false, error: `"${slug}" is reserved by the app. Please choose another.` };
  }

  return { valid: true, slug };
}

/** Suggests a slug from a display name. Never returns a reserved value. */
export function slugify(name) {
  const base = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');

  if (!base) return '';
  return RESERVED_SLUGS.includes(base) ? `${base}-session`.slice(0, 40) : base;
}

/** Presentation defaults, so a new session looks deliberate rather than blank. */
export const SESSION_ICONS = [
  'bi-sunrise-fill',
  'bi-sun-fill',
  'bi-moon-stars-fill',
  'bi-cloud-sun-fill',
  'bi-book-fill',
  'bi-mortarboard-fill',
  'bi-calendar-week-fill',
  'bi-lightning-charge-fill',
];

export const SESSION_GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
];

export const MAX_SESSION_DESCRIPTION = 160;
export const SESSION_TZ = 'Africa/Nairobi';

/**
 * Classes offered by a session's registration form when the teacher has not
 * set a list for it. Mirror of DEFAULT_CLASSES in api/_lib/sessions.js.
 */
export const DEFAULT_CLASSES = Object.freeze(['Form One', 'Form Two', 'Form Three', 'Form Four']);
export const MAX_CLASSES = 30;
export const MAX_CLASS_NAME = 60;

/**
 * The two default sessions — Phase 13 / 02 D1. Mirror of DEFAULT_SESSIONS in
 * api/_lib/sessions.js (a parity test keeps them identical). The server creates
 * these documents on first use; the client uses this copy only as the fallback
 * when the session list cannot be read (offline, or before the bootstrap has
 * run), so the homepage and /morning, /evening never render empty.
 */
export const DEFAULT_SESSIONS = Object.freeze([
  Object.freeze({
    slug: 'morning',
    name: 'Morning Session',
    description: 'Start your day with focused learning and interactive classes',
    schedule: Object.freeze({ days: [], startTime: '08:00', endTime: '12:00', tz: SESSION_TZ }),
    icon: 'bi-sunrise-fill',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    order: 0,
  }),
  Object.freeze({
    slug: 'evening',
    name: 'Evening Session',
    description: 'Perfect for after-school learning and homework support',
    schedule: Object.freeze({ days: [], startTime: '16:00', endTime: '20:00', tz: SESSION_TZ }),
    icon: 'bi-moon-stars-fill',
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    order: 1,
  }),
]);

/** Fallback session documents, keyed by slug, in the Firestore document shape. */
export const FALLBACK_SESSIONS = DEFAULT_SESSIONS.map((d) => ({ id: d.slug, active: true, ...d }));

export const DEFAULT_SESSION_ICON = 'bi-book-fill';
export const DEFAULT_SESSION_GRADIENT = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
