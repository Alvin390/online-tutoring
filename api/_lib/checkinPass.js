import { createHmac } from 'node:crypto';
import { safeCompare } from './crypto.js';
import { edgeLimitAllows } from './requestContext.js';

/**
 * The check-in pass — 002Fixes / 07.
 *
 * The check-in limits exist to stop someone TYPING MANY NUMBERS to find out
 * who is registered. On 26 Oct they caught students checking THEIR OWN number
 * again and again ("Check again" while waiting for approval) and locked them
 * out of class. Those repeat checks reveal nothing the student has not already
 * been shown.
 *
 * So a check-in that finds the student (or a registration) hands back a short
 * signed pass bound to that session and number. Requests that carry it skip
 * the Firestore limiters — which also makes them one or two round trips
 * faster. Getting a pass still costs one normal, limited check-in per number,
 * so probing other numbers is exactly as bounded as before. Entitlement
 * (approval, blocking, the class link) is still decided by the server on
 * every request: the pass skips COUNTING, never CHECKING.
 *
 * Format: v1.<expiry, unix seconds>.<HMAC-SHA256 base64url>. It carries no
 * phone digits — Cloudflare logs request headers. The key is derived from
 * APP_ENCRYPTION_KEY, so no new secret, and that key is never used directly.
 * Without the key no pass is issued and every request is limited as before.
 */

export const PASS_HEADER = 'x-checkin-pass';
export const PASS_LIFETIME_SECONDS = 4 * 60 * 60; // an early arrival plus a 2-hour class

const PASS_RE = /^v1\.(\d{10})\.([A-Za-z0-9_-]{43})$/;

function passKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) return null;
  return createHmac('sha256', key).update('checkin-pass-v1').digest();
}

const sign = (key, session, phone, expiry) =>
  createHmac('sha256', key).update(`v1|${session}|${phone}|${expiry}`).digest('base64url');

/** A pass for this session and number, or null when no key is configured. */
export function issuePass({ session, phone, now = Date.now() }) {
  const key = passKey();
  if (!key) return null;
  const expiry = Math.floor(now / 1000) + PASS_LIFETIME_SECONDS;
  return `v1.${expiry}.${sign(key, session, phone, expiry)}`;
}

/** True only for an unexpired pass issued for exactly this session and number. */
export function verifyPass(pass, { session, phone, now = Date.now() }) {
  const key = passKey();
  const match = key && typeof pass === 'string' ? PASS_RE.exec(pass) : null;
  if (!match) return false;
  const expiry = Number(match[1]);
  const nowSeconds = now / 1000;
  if (expiry <= nowSeconds || expiry > nowSeconds + PASS_LIFETIME_SECONDS + 60) return false;
  return safeCompare(match[2], sign(key, session, phone, expiry));
}

/**
 * The createHandler `rateLimit.bypass` hook for student endpoints: a valid
 * pass for the body's session and number skips the Firestore limiters —
 * within Cloudflare's own in-memory limiter (CHECKIN_PASS_LIMITER, 15 a minute
 * per pass), which only a runaway client could reach. Past that, or with any
 * doubt, the request is limited exactly as one without a pass.
 */
export async function passBypass({ req, body }) {
  const pass = req.headers[PASS_HEADER];
  if (!verifyPass(pass, { session: body?.session, phone: body?.phone })) return false;
  return edgeLimitAllows(`pass:${pass.slice(-43)}`);
}
