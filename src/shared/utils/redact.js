/**
 * Redaction layer — Phase 01 D3.
 *
 * Everything that leaves the process (console, log buffer, Sentry) passes
 * through here first. Two independent passes, because neither alone is enough:
 *
 *  1. Key-based. A value whose key is known to hold free text or a secret is
 *     dropped wholesale. Pattern matching cannot be trusted on free text — a
 *     payment receipt message contains a phone number AND an M-Pesa code AND an
 *     amount AND a name, in a format we do not control. The only safe move is
 *     not to look at it.
 *
 *  2. Pattern-based. Catches identifiers that turn up inside otherwise
 *     innocuous strings — an error message that quotes a document path, for
 *     instance, where the document ID is the parent's phone number.
 */

const REDACTED = '[redacted]';
const BULLET = '•';

/**
 * Matched case-insensitively as a substring of the key, so `parentPhone`,
 * `phone` and `phoneNumber` are all covered by 'phone'.
 */
const SENSITIVE_KEY_PARTS = [
  // Free text written by, or about, a student
  'receiptmessage',
  'pendingreceipt',
  'blockreason',
  'rejectionreason',
  'resolvedmessage',
  'messagetemplate',
  'note',
  'body',
  // Direct identifiers
  'phone',
  'msisdn',
  'email',
  // Secrets
  'password',
  'secret',
  'passkey',
  'token',
  'authorization',
  'apikey',
  'api_key',
  'consumerkey',
  'consumersecret',
  'privatekey',
  'private_key',
  'serviceaccount',
  'credential',
  'signature',
];

/** E.164, which is the only phone format this app stores (rules enforce it). */
const PHONE_RE = /\+\d{7,19}/g;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * M-Pesa transaction codes: exactly 10 uppercase alphanumerics containing at
 * least one letter and at least one digit. The lookaheads keep this from
 * eating ordinary 10-character words or 10-digit numbers.
 */
const MPESA_RE = /\b(?=[A-Z0-9]{10}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{10}\b/g;

const MAX_DEPTH = 6;

export function maskPhone(value) {
  const s = String(value);
  if (s.length <= 8) return BULLET.repeat(s.length);
  // Keep enough leading digits to identify the country, and a 3-digit tail so
  // a human can still correlate two log lines about the same student.
  return `${s.slice(0, 5)}${BULLET.repeat(5)}${s.slice(-3)}`;
}

export function maskEmail(value) {
  const s = String(value);
  const at = s.indexOf('@');
  if (at < 1) return REDACTED;
  return `${s[0]}${BULLET.repeat(3)}${s.slice(at)}`;
}

export function maskCode(value) {
  const s = String(value);
  if (s.length <= 3) return BULLET.repeat(s.length);
  return `${s.slice(0, 3)}${BULLET.repeat(s.length - 3)}`;
}

function isSensitiveKey(key) {
  const k = String(key).toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

/** Pattern pass over a single string. */
export function redactString(input) {
  if (typeof input !== 'string' || input.length === 0) return input;
  return input
    .replace(EMAIL_RE, maskEmail)
    .replace(PHONE_RE, maskPhone)
    .replace(MPESA_RE, maskCode);
}

/**
 * Deep-walks a value applying both passes. Cycle-safe and depth-capped, since
 * this runs on arbitrary objects including caught Firebase errors, which carry
 * rich nested internals.
 */
export function redact(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'bigint' || typeof value === 'symbol') return String(value);

  if (depth >= MAX_DEPTH) return '[truncated]';

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      code: value.code,
      stack: typeof value.stack === 'string' ? redactString(value.stack) : undefined,
    };
  }

  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => redact(item, depth + 1, seen));
    }

    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1, seen);
    }
    return out;
  }

  return value;
}

/**
 * Sentry `beforeSend` hook. Applies the same redaction to the outbound event so
 * PII cannot escape through error reporting — the path that is easiest to
 * forget, because nobody reads it during development.
 */
export function redactSentryEvent(event) {
  if (!event) return event;

  if (event.message) event.message = redactString(event.message);

  if (Array.isArray(event.exception?.values)) {
    event.exception.values.forEach((ex) => {
      if (ex.value) ex.value = redactString(ex.value);
    });
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs.forEach((crumb) => {
      if (crumb.message) crumb.message = redactString(crumb.message);
      if (crumb.data) crumb.data = redact(crumb.data);
    });
  }

  if (event.request?.url) event.request.url = redactString(event.request.url);
  if (event.extra) event.extra = redact(event.extra);
  if (event.contexts) event.contexts = redact(event.contexts);

  // The user object is the single most likely place for an identifier to ride
  // out. Keep only a non-identifying id.
  if (event.user) {
    event.user = { id: event.user.id ? maskCode(event.user.id) : undefined };
  }

  return event;
}

export { REDACTED };
