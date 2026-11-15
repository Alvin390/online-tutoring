import { getDb } from './firebaseAdmin.js';

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

const BASE = 'https://api.hashback.co.ke/sms';

export class SmsError extends Error {
  constructor(code, message, { status = null, retryAfter = null } = {}) {
    super(message || code);
    this.name = 'SmsError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export const smsAvailable = () =>
  Boolean(process.env.HASHBACK_API_KEY) && process.env.SMS_DISABLED !== 'true';

async function request(path, { method = 'GET', body } = {}) {
  if (!smsAvailable()) throw new SmsError('sms_unavailable', 'SMS is not configured.');
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
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

/** One message to one number. @returns {{ id, units, cost, balance, status }} */
export async function sendSms({ to, message }) {
  const json = await request('/send', { method: 'POST', body: { to, message } });
  return {
    id: json.id ?? null,
    units: Number(json.units) || 0,
    cost: Number(json.cost) || 0,
    balance: Number.isFinite(Number(json.balance)) ? Number(json.balance) : null,
    status: json.status ?? null,
  };
}

/** Free pricing of a send (same body as /send or /bulk). */
export const quoteSms = (body) => request('/quote', { method: 'POST', body });
export const smsBalance = () => request('/balance');
export const smsSenders = () => request('/senders');
export const smsStatus = (id) => request(`/status?id=${encodeURIComponent(id)}`);
export const smsMessages = ({ limit = 50, offset = 0 } = {}) => request(`/messages?limit=${limit}&offset=${offset}`);

/**
 * The wallet balance every HashBack reply carries, kept for the cost tracker
 * (Release B builds the alerts on it). Best-effort: never fails a send.
 */
export async function recordSmsBalance(balance, { log } = {}) {
  if (!Number.isFinite(balance)) return;
  try {
    await getDb().doc('config/smsBalance').set({ balance, at: new Date() }, { merge: true });
  } catch (err) {
    log?.warn?.('SMS balance not recorded', { code: err?.code });
  }
}
