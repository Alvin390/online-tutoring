/**
 * Server-side logger — Phase 01 D3, server half.
 *
 * A deliberate duplicate of the redaction rules in src/shared/utils/redact.js.
 * It is duplicated rather than imported because `/api` is a separate build
 * target with no Vite alias resolution and no `import.meta.env`, and a runtime
 * import across that boundary would couple the serverless bundle to the client
 * bundle for no benefit.
 *
 * If you change a masking rule, change it in both files. The rules unit tests
 * assert the two agree.
 */

const REDACTED = '[redacted]';
const BULLET = '•';

const SENSITIVE_KEY_PARTS = [
  'receiptmessage', 'pendingreceipt', 'blockreason', 'rejectionreason',
  'resolvedmessage', 'messagetemplate', 'note', 'body',
  'phone', 'msisdn', 'email',
  'password', 'secret', 'passkey', 'token', 'authorization', 'apikey',
  'api_key', 'consumerkey', 'consumersecret', 'privatekey', 'private_key',
  'serviceaccount', 'credential', 'signature',
];

const PHONE_RE = /\+\d{7,19}/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MPESA_RE = /\b(?=[A-Z0-9]{10}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{10}\b/g;

const MAX_DEPTH = 6;

export function maskPhone(value) {
  const s = String(value);
  if (s.length <= 8) return BULLET.repeat(s.length);
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

export function redactString(input) {
  if (typeof input !== 'string' || input.length === 0) return input;
  return input
    .replace(EMAIL_RE, maskEmail)
    .replace(PHONE_RE, maskPhone)
    .replace(MPESA_RE, maskCode);
}

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

    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));

    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PARTS.some((p) => key.toLowerCase().includes(p))
        ? REDACTED
        : redact(val, depth + 1, seen);
    }
    return out;
  }

  return value;
}

function emit(level, requestId, message, meta) {
  const line = {
    ts: new Date().toISOString(),
    level,
    requestId,
    msg: redactString(message),
    ...(meta === undefined ? {} : { meta: redact(meta) }),
  };
  // Structured single-line JSON: greppable in Vercel's log viewer.
  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

/** Per-request logger; the request ID ties a chain of lines together. */
export function createLogger(requestId) {
  return {
    requestId,
    debug: (msg, meta) => emit('debug', requestId, msg, meta),
    info: (msg, meta) => emit('info', requestId, msg, meta),
    warn: (msg, meta) => emit('warn', requestId, msg, meta),
    error: (msg, meta) => emit('error', requestId, msg, meta),
  };
}

export { REDACTED };
