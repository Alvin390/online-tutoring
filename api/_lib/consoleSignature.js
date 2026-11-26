import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The owner console's signed requests — 013Fixes / 37-38 (owner suggestion 9).
 *
 * One secret (CONSOLE_SECRET) is shared by the console and every school. A
 * request is signed over its method, host, path and timestamp, so a captured
 * signature only works for that one school and path, for 5 minutes:
 *
 *   x-console-timestamp  milliseconds since the epoch
 *   x-console-signature  hex HMAC-SHA256(CONSOLE_SECRET, "METHOD\nhost\npath\ntimestamp")
 *
 * Used by the school (verify) and the console (sign) — the same bytes on both
 * sides (tests/unit/fixes013/consoleSignature.test.js).
 */

export const TIMESTAMP_HEADER = 'x-console-timestamp';
export const SIGNATURE_HEADER = 'x-console-signature';
export const MAX_SKEW_MS = 5 * 60_000;

export const signingString = ({ method, host, path, timestamp }) =>
  `${String(method).toUpperCase()}\n${String(host).toLowerCase()}\n${path}\n${timestamp}`;

export function signConsoleRequest(secret, { method = 'GET', host, path, timestamp = Date.now() }) {
  const signature = createHmac('sha256', secret).update(signingString({ method, host, path, timestamp })).digest('hex');
  return { [TIMESTAMP_HEADER]: String(timestamp), [SIGNATURE_HEADER]: signature };
}

/** @returns {{ ok: boolean, reason?: 'missing'|'stale'|'bad_signature' }} */
export function verifyConsoleRequest(secret, { method, host, path, timestamp, signature, now = Date.now() }) {
  if (!timestamp || !signature) return { ok: false, reason: 'missing' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) return { ok: false, reason: 'stale' };
  const expected = createHmac('sha256', secret).update(signingString({ method, host, path, timestamp: String(timestamp) })).digest();
  const given = /^[0-9a-f]{64}$/i.test(String(signature)) ? Buffer.from(String(signature), 'hex') : null;
  if (!given || given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}
