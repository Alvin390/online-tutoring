/**
 * HashBack SMS client — 008Fixes / 01 (owner, 2026-11-14: SMS through
 * HashBack, the owner's account, the shared sender HASHBACKSMS).
 *
 * Base https://api.hashback.co.ke/sms/, `Authorization: Bearer HASHBACK_API_KEY`.
 * Checked read-only on 2026-11-15 (issues/008Fixes/SETUP-GUIDE.md): 168 plain
 * characters a unit, KES 0.35 a unit; HashBack cannot fill our own text per
 * person (Release B sends personalised messages one at a time).
 *
 * Errors are branched on HashBack's stable `code` (INSUFFICIENT_FUNDS,
 * RATE_LIMITED, SENDER_*), never on its English text. With no key, or with
 * SMS_DISABLED=true, every call throws `sms_unavailable` before any request:
 * callers fall back (one-time codes are then read out by the teacher).
 *
 * Nothing here logs a phone number or a message body.
 */

import { randomUUID } from 'node:crypto';
import { smsMode } from './mode.js';

const HASHBACK = 'https://api.hashback.co.ke/sms';

/**
 * Where requests go: HashBack, or — for local browser checks only — a fake on
 * this machine (HASHBACK_BASE_URL=http://127.0.0.1:…). Any other override is
 * ignored, so a misconfigured deployment can never send the key elsewhere.
 */
function baseUrl() {
  const override = process.env.HASHBACK_BASE_URL;
  return override && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(override) ? override.replace(/\/$/, '') : HASHBACK;
}

export class SmsError extends Error {
  constructor(code, message, { status = null, retryAfter = null } = {}) {
    super(message || code);
    this.name = 'SmsError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** HashBack itself is usable (a key, and not disabled). */
const providerAvailable = () =>
  Boolean(process.env.HASHBACK_API_KEY) && process.env.SMS_DISABLED !== 'true';

/**
 * 013Fixes / 33b: SMS on fake (the superadmin's switch or SMS_MODE=fake):
 * nothing is sent to HashBack and no units are used. Callers where a real
 * person waits for the message (check-in codes, the test SMS, the number SMS)
 * check this and take their "not sent" route instead.
 */
export const smsFake = () => smsMode() === 'fake';

/** Sending can go ahead: fake always (no key needed), real with HashBack. */
export const smsAvailable = () => smsFake() || providerAvailable();

const FAKE_PREFIX = 'fake_';
export const isFakeSmsId = (id) => typeof id === 'string' && id.startsWith(FAKE_PREFIX);

async function request(path, { method = 'GET', body } = {}) {
  if (!providerAvailable()) throw new SmsError('sms_unavailable', 'SMS is not configured.');
  let res;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.HASHBACK_API_KEY}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw new SmsError('network_error', err?.message || 'SMS provider unreachable.');
  }
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok || !json || json.success === false) {
    const retry = Number(res.headers?.get?.('retry-after'));
    throw new SmsError(
      json?.code || `http_${res.status}`,
      json?.message || `SMS provider answered ${res.status}.`,
      { status: res.status, retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null },
    );
  }
  return json;
}

/** One message to one number. @returns {{ id, units, cost, balance, status, fake? }} */
export async function sendSms({ to, message }) {
  if (smsFake()) {
    // Recorded as fake by the caller; HashBack never sees it.
    return { id: `${FAKE_PREFIX}${randomUUID()}`, units: 0, cost: 0, balance: null, status: 'fake', senderId: null, fake: true };
  }
  const json = await request('/send', { method: 'POST', body: { to, message } });
  return {
    id: json.id ?? null,
    units: Number(json.units) || 0,
    cost: Number(json.cost) || 0,
    balance: Number.isFinite(Number(json.balance)) ? Number(json.balance) : null,
    status: json.status ?? null,
    senderId: json.sender_id ?? null,
  };
}

/** Free pricing of a send (same body as /send or /bulk). */
export const quoteSms = (body) => request('/quote', { method: 'POST', body });
export const smsBalance = () => request('/balance');
export const smsSenders = () => request('/senders');
export const smsStatus = (id) => (isFakeSmsId(id)
  // 013Fixes / 33b: a fake message is never asked about; it counts as delivered.
  ? Promise.resolve({ success: true, sms: { status: 'delivered', fake: true } })
  : request(`/status?id=${encodeURIComponent(id)}`));
export const smsMessages = ({ limit = 50, offset = 0 } = {}) => request(`/messages?limit=${limit}&offset=${offset}`);

/**
 * The wallet balance every HashBack reply carries, kept for the cost tracker
 * and the credit alerts — 008Fixes / 07 moved it to api/_lib/smsCredit.js.
 */
export { recordSmsBalance } from './smsCredit.js';
