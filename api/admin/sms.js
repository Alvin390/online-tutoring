import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { ApiError } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { getNotificationSettings } from '../_lib/reports.js';
import { smsBalance, SmsError } from '../_lib/sms.js';
import { recordSmsBalance, monthKey, SMS_RESERVE_KES, ALERT_USED_FRACTION } from '../_lib/smsCredit.js';
import { SMS_RATE_KES } from '../_lib/smsText.js';
import { creditContext, readCredits, addTopup, recentLedger } from '../_lib/smsCredits.js';

/**
 * The superadmin SMS card — 008Fixes / 10 (owner answers 6 and 8: track the
 * spend, alert at 80% used and at no credit; no cap).
 *
 *   summary               the wallet (balance, used since the last top-up,
 *                         the alerts sent), usage per teacher (this month and
 *                         in total), the setup, where alerts go
 *   refresh               one HashBack /balance call, recorded (a top-up is
 *                         noticed here too), then the summary
 *   setAlertRecipient     where the credit alerts go (audited)
 *   resetAlertRecipient   back to the report recipient (audited)
 *
 * Reads three documents (config/smsBalance, smsUsage, smsSetup) plus the
 * notification settings; nothing listens.
 */

const schema = z.object({
  action: z.enum(['summary', 'refresh', 'setAlertRecipient', 'resetAlertRecipient', 'credits', 'addUnits']),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  // 013Fixes / 14: SMS units added by hand (after an off-platform payment).
  units: z.number().int().min(1).max(1_000_000).optional(),
  note: z.string().trim().max(120).optional(),
  key: z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
}).strict();

const iso = (v) => v?.toDate?.()?.toISOString?.() ?? (v instanceof Date ? v.toISOString() : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);

async function summary(db) {
  const [balanceSnap, usageSnap, setupSnap, settings] = await Promise.all([
    db.doc('config/smsBalance').get(),
    db.doc('config/smsUsage').get(),
    db.doc('config/smsSetup').get(),
    getNotificationSettings(db),
  ]);
  const b = balanceSnap.exists ? balanceSnap.data() : null;
  const month = monthKey();
  const byTeacher = usageSnap.exists ? (usageSnap.data().byTeacher ?? {}) : {};
  const usage = Object.entries(byTeacher).map(([uid, t]) => ({
    uid,
    email: t.email ?? null,
    units: num(t.units),
    cost: num(t.cost),
    monthUnits: num(t.months?.[month]?.units),
    monthCost: num(t.months?.[month]?.cost),
    lastAt: iso(t.lastAt),
  })).sort((x, y) => y.monthCost - x.monthCost || y.cost - x.cost);
  const setup = setupSnap.exists ? setupSnap.data() : {};
  return {
    balance: b && typeof b.balance === 'number' ? {
      balance: num(b.balance),
      units: Math.floor(b.balance / SMS_RATE_KES + 1e-9),
      fullAt: num(b.fullAt),
      usedFraction: typeof b.usedFraction === 'number' ? b.usedFraction : 0,
      at: iso(b.at),
      topUpAt: iso(b.topUpAt),
      alerted80At: iso(b.alerted80At),
      alertedEmptyAt: iso(b.alertedEmptyAt),
    } : null,
    month,
    usage,
    totals: {
      monthUnits: num(usage.reduce((s, t) => s + t.monthUnits, 0)),
      monthCost: num(usage.reduce((s, t) => s + t.monthCost, 0)),
      units: num(usage.reduce((s, t) => s + t.units, 0)),
      cost: num(usage.reduce((s, t) => s + t.cost, 0)),
    },
    setup: { unlocked: Boolean(setup.unlockedAt), unlockedAt: iso(setup.unlockedAt), unlockedByEmail: setup.unlockedByEmail ?? null, schoolName: setup.schoolName ?? '' },
    alerts: {
      recipient: settings.smsAlertRecipient || settings.reportRecipient || null,
      source: settings.smsAlertRecipient ? 'sms' : settings.reportRecipient ? 'report' : null,
      usedThreshold: ALERT_USED_FRACTION,
    },
    rate: SMS_RATE_KES,
    reserve: SMS_RESERVE_KES,
  };
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  rateLimit: { bucket: 'admin_sms', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const db = getDb();

    if (body.action === 'summary') return summary(db);

    // 013Fixes / 14: the school's SMS units (included this window, top-up) and the ledger.
    if (body.action === 'credits') {
      const ctx = await creditContext(db);
      const [credits, ledger] = await Promise.all([readCredits(db, ctx), recentLedger(db, 20)]);
      return { credits, ledger };
    }
    if (body.action === 'addUnits') {
      if (!body.units || !body.key) throw new ApiError(400, 'units_required', 'Enter how many SMS units to add.');
      const ctx = await creditContext(db);
      const result = await addTopup(db, { ...ctx, units: body.units, note: body.note ?? null, key: body.key, actor: user.uid });
      if (!result.already) {
        await tryWriteAudit({
          action: 'sms.units_added', actor: user.uid, actorRole: user.role, target: 'sms/credits',
          after: { units: body.units, topup: result.credits.topup }, context: { requestId: log.requestId, note: body.note ?? null },
        }, log);
      }
      return { ...result, ledger: await recentLedger(db, 20) };
    }

    if (body.action === 'refresh') {
      let json;
      try {
        json = await smsBalance();
      } catch (err) {
        if (err instanceof SmsError && err.code === 'sms_unavailable') throw new ApiError(503, 'sms_unavailable', 'SMS is not configured on this server.');
        log.warn('SMS balance check failed', { code: err?.code });
        throw new ApiError(502, 'balance_unavailable', 'HashBack did not answer. Please try again in a minute.');
      }
      const balance = Number(json.balance);
      if (Number.isFinite(balance)) await recordSmsBalance(balance, { db, log });
      return summary(db);
    }

    const ref = db.doc('config/notifications');
    const before = (await getNotificationSettings(db)).smsAlertRecipient ?? null;
    if (body.action === 'setAlertRecipient') {
      if (!body.email) throw new ApiError(400, 'email_required', 'Enter an email address.');
      await ref.set({ smsAlertRecipient: body.email, updatedAt: new Date(), updatedBy: user.uid }, { merge: true });
    } else {
      await ref.set({ smsAlertRecipient: FieldValue.delete(), updatedAt: new Date(), updatedBy: user.uid }, { merge: true });
    }
    await tryWriteAudit({
      action: 'sms.alert_recipient_changed', actor: user.uid, actorRole: user.role, target: 'config/notifications',
      before: { smsAlertRecipient: before }, after: { smsAlertRecipient: body.action === 'setAlertRecipient' ? body.email : null },
      context: { requestId: log.requestId },
    }, log);
    return summary(db);
  },
});
