import { getDb, FieldValue } from './firebaseAdmin.js';
import { gmailConfigured, sendGmail } from './gmail.js';
import { getNotificationSettings } from './reports.js';
import { SMS_RATE_KES } from './smsText.js';

/**
 * SMS credit and usage — 008Fixes / 07 (owner answers 6 and 8: no new cron;
 * alert at 80% used and when the credit runs out; no per-teacher cap, just
 * tracking).
 *
 * Every HashBack reply carries the wallet balance. `recordSmsBalance` keeps it
 * in `config/smsBalance` and works out the rest from it:
 *   - a balance HIGHER than the last one is a top-up: it becomes the new
 *     100% (`fullAt`), and the alerts are armed again;
 *   - used = 1 − balance / fullAt; at 80% one email, at "can't send one SMS"
 *     another — each once per top-up;
 * The alert address is a setting (`config/notifications.smsAlertRecipient`,
 * set on the superadmin page), falling back to the report recipient. It is
 * never in the code.
 *
 * `recordSmsUsage` adds units and KES per teacher and month in
 * `config/smsUsage`, for the superadmin page.
 *
 * Both are best-effort: a failure here never fails a send.
 */

export const ALERT_USED_FRACTION = 0.8;
/** Bulk SMS stops below this, so one-time check-in codes always have credit (owner answer 7). */
export const SMS_RESERVE_KES = 100;

const BALANCE_DOC = 'config/smsBalance';
const USAGE_DOC = 'config/smsUsage';

const monthKey = (ms = Date.now()) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 7); // Nairobi month

/** The next state of config/smsBalance after a reply with `balance`, and the alerts it calls for. */
export function nextBalanceState(previous, balance, nowMs = Date.now()) {
  const prev = previous ?? {};
  const state = {
    balance,
    at: new Date(nowMs),
    fullAt: typeof prev.fullAt === 'number' ? prev.fullAt : balance,
    topUpAt: prev.topUpAt ?? null,
    alerted80At: prev.alerted80At ?? null,
    alertedEmptyAt: prev.alertedEmptyAt ?? null,
  };
  // A rise is a top-up (sends only ever lower it): the new 100%, alerts re-armed.
  if (typeof prev.balance === 'number' && balance > prev.balance + 0.005) {
    state.fullAt = balance;
    state.topUpAt = new Date(nowMs);
    state.alerted80At = null;
    state.alertedEmptyAt = null;
  }
  if (balance > state.fullAt) state.fullAt = balance;
  state.usedFraction = state.fullAt > 0 ? Math.max(0, Math.min(1, 1 - balance / state.fullAt)) : 0;

  const alerts = [];
  if (balance < SMS_RATE_KES && !state.alertedEmptyAt) {
    // Out of credit: one email says it all (the 80% one is not sent as well).
    alerts.push('empty');
    state.alertedEmptyAt = new Date(nowMs);
    if (!state.alerted80At) state.alerted80At = new Date(nowMs);
  } else if (state.usedFraction >= ALERT_USED_FRACTION && !state.alerted80At) {
    alerts.push('used80');
    state.alerted80At = new Date(nowMs);
  }
  return { state, alerts };
}

function alertEmail(kind, state) {
  const kes = (v) => `KES ${Number(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const used = Math.round(state.usedFraction * 100);
  if (kind === 'empty') {
    return {
      subject: 'SMS credit has run out',
      text: `The SMS wallet has ${kes(state.balance)} left: not enough for one SMS.\n\nCheck-in codes and teacher messages cannot be sent by SMS until it is topped up (HashBack dashboard → SMS → Top up). Codes can still be read out by the teacher from her dashboard.\n\nLast top-up: ${kes(state.fullAt)}.`,
    };
  }
  return {
    subject: `SMS credit ${used}% used`,
    text: `The SMS wallet has ${kes(state.balance)} left of ${kes(state.fullAt)} (${used}% used).\n\nPlease top up soon (HashBack dashboard → SMS → Top up). Bulk SMS stops at ${kes(SMS_RESERVE_KES)} so check-in codes keep working.`,
  };
}

/** Where SMS credit alerts go: the superadmin's setting, else the report recipient. */
export async function smsAlertRecipient(db) {
  const settings = await getNotificationSettings(db);
  return settings.smsAlertRecipient || settings.reportRecipient || null;
}

async function sendAlerts(db, alerts, state, log) {
  if (!alerts.length || !gmailConfigured()) return;
  const to = await smsAlertRecipient(db);
  if (!to) return;
  for (const kind of alerts) {
    const { subject, text } = alertEmail(kind, state);
    try {
      // eslint-disable-next-line no-await-in-loop
      await sendGmail({ to, subject, text });
      log?.info?.('SMS credit alert sent', { kind });
    } catch (err) {
      log?.warn?.('SMS credit alert not sent', { kind, code: err?.code });
    }
  }
}

/**
 * Keeps the balance a HashBack reply reported, and sends any alert it calls
 * for. Best-effort (never throws). Returns the new state, or null.
 */
export async function recordSmsBalance(balance, { log, db = getDb(), nowMs = Date.now() } = {}) {
  if (!Number.isFinite(balance)) return null;
  try {
    const ref = db.doc(BALANCE_DOC);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = nextBalanceState(snap.exists ? snap.data() : null, balance, nowMs);
      tx.set(ref, next.state, { merge: true });
      return next;
    });
    await sendAlerts(db, result.alerts, result.state, log);
    return result.state;
  } catch (err) {
    log?.warn?.('SMS balance not recorded', { code: err?.code });
    return null;
  }
}

/** Adds what a teacher sent: units and KES, in total and for this month. Best-effort. */
export async function recordSmsUsage({ uid, email = null, units, cost, log, db = getDb(), nowMs = Date.now() }) {
  if (!uid || !(units > 0)) return;
  const month = monthKey(nowMs);
  try {
    await db.doc(USAGE_DOC).set({
      byTeacher: {
        [uid]: {
          units: FieldValue.increment(units),
          cost: FieldValue.increment(cost),
          lastAt: new Date(nowMs),
          ...(email ? { email } : {}),
          months: { [month]: { units: FieldValue.increment(units), cost: FieldValue.increment(cost) } },
        },
      },
    }, { merge: true });
  } catch (err) {
    log?.warn?.('SMS usage not recorded', { code: err?.code });
  }
}

/** The last balance seen (for the reserve check), or null when none was ever recorded. */
export async function lastKnownBalance(db = getDb()) {
  const snap = await db.doc(BALANCE_DOC).get();
  return snap.exists && typeof snap.data().balance === 'number' ? snap.data().balance : null;
}

export { monthKey };
