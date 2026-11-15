import { createHmac } from 'node:crypto';
import { safeCompare } from './crypto.js';

/**
 * The verified-phone ticket — 008Fixes / 01.
 *
 * After a correct one-time code, POST /api/student/verifyCode hands back this
 * short-lived signed ticket bound to the session and number. Choosing an
 * admission number requires it: knowing a phone number is not enough to pick
 * that student's number for them (a check-in pass is not proof — any caller
 * who knows the number gets one).
 *
 * Student pages load no Firebase, so the Firebase custom token the code flow
 * once minted is of no use to them; this follows the check-in pass pattern
 * instead (api/_lib/checkinPass.js): v1.<expiry>.<HMAC-SHA256 base64url>,
 * keyed by a label-derived key from APP_ENCRYPTION_KEY (never the key itself),
 * no phone digits inside. Without the key no ticket is issued.
 */

export const TICKET_LIFETIME_SECONDS = 30 * 60;
const TICKET_RE = /^v1\.(\d{10})\.([A-Za-z0-9_-]{43})$/;

function ticketKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) return null;
  return createHmac('sha256', key).update('verify-ticket-v1').digest();
}

const sign = (key, session, phone, expiry) =>
  createHmac('sha256', key).update(`verified|${session}|${phone}|${expiry}`).digest('base64url');

export function issueTicket({ session, phone, now = Date.now() }) {
  const key = ticketKey();
  if (!key) return null;
  const expiry = Math.floor(now / 1000) + TICKET_LIFETIME_SECONDS;
  return `v1.${expiry}.${sign(key, session, phone, expiry)}`;
}

export function verifyTicket(ticket, { session, phone, now = Date.now() }) {
  const key = ticketKey();
  const match = key && typeof ticket === 'string' ? TICKET_RE.exec(ticket) : null;
  if (!match) return false;
  const expiry = Number(match[1]);
  const nowSeconds = now / 1000;
  if (expiry <= nowSeconds || expiry > nowSeconds + TICKET_LIFETIME_SECONDS + 60) return false;
  return safeCompare(match[2], sign(key, session, phone, expiry));
}
