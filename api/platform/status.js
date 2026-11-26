import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { ApiError } from '../_lib/errors.js';
import { verifyConsoleRequest, TIMESTAMP_HEADER, SIGNATURE_HEADER } from '../_lib/consoleSignature.js';
import { publicProjection } from '../_lib/subscription.js';
import { readBillingSettings } from '../_lib/billingSettings.js';
import { creditContext, peekCredits } from '../_lib/smsCredits.js';
import { readMpesaStatus, modeOf } from '../_lib/mpesaStatus.js';
import { paystackMode, smsMode } from '../_lib/mode.js';
import { maintenanceState, runtimeModes } from '../_lib/runtimeModes.js';
import { workerVersion } from '../_lib/requestContext.js';

/**
 * GET /api/platform/status — 013Fixes / 37 (owner suggestion 9).
 *
 * What the owner console shows for this school: name, plan and its dates, the
 * last payment (date, amount, method, tier), usage as last counted, SMS units
 * left, the mode switches, M-Pesa's setting and the deployed version.
 *
 * - Signed with the shared CONSOLE_SECRET (api/_lib/consoleSignature.js);
 *   anything else is 401. With no secret set, the link is switched off: 404.
 * - An explicit allowlist: never a student, a phone, an email, a payment code
 *   or reference, a Paystack code, the owner's id, or the maintenance message
 *   (owner free text).
 * - Reads only what is stored (no recount, no credit grant): it writes nothing
 *   but the rate limiter's counter. Answers during maintenance.
 */

const ms = (t) => (t == null ? null : t.toMillis?.() ?? (t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : null)));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function lastPayment(db) {
  const snap = await db.collection('billing/payments/items').orderBy('createdAt', 'desc').limit(1).get();
  if (snap.empty) return null;
  const p = snap.docs[0].data();
  return { at: ms(p.createdAt), amountKes: num(p.amountKes), method: p.method ?? null, tier: p.tier ?? null };
}

async function usage(db) {
  const snap = await db.doc('config/usage').get();
  if (!snap.exists) return null;
  const u = snap.data();
  const pick = (o) => (o && typeof o === 'object'
    ? { activeStudents: num(o.activeStudents), sessions: num(o.sessions), logins: num(o.logins) }
    : null);
  return {
    activeStudents: num(u.activeStudents), sessions: num(u.sessions), logins: num(u.logins),
    limits: pick(u.limits), percent: pick(u.percent), countedAt: num(u.countedAtMs) ?? ms(u.countedAt),
  };
}

export default createHandler({
  method: 'GET',
  // It reports maintenance, so it must answer during it.
  maintenance: false,
  rateLimit: { bucket: 'platform_status', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ req, log }) => {
    const secret = process.env.CONSOLE_SECRET;
    if (!secret) throw new ApiError(404, 'not_found', 'Not found.');
    const check = verifyConsoleRequest(secret, {
      method: req.method,
      host: req.host ?? req.headers.host ?? '',
      path: String(req.url ?? '').split('?')[0],
      timestamp: req.headers[TIMESTAMP_HEADER],
      signature: req.headers[SIGNATURE_HEADER],
    });
    if (!check.ok) {
      log.warn('Console status request refused', { reason: check.reason });
      throw new ApiError(401, 'unauthorized', 'Not allowed.');
    }

    const db = getDb();
    const [subSnap, settings, setupSnap, payment, used, mpesa, ctx] = await Promise.all([
      db.doc('subscription/current').get(),
      readBillingSettings(db).catch(() => undefined),
      db.doc('config/smsSetup').get(),
      lastPayment(db),
      usage(db),
      readMpesaStatus(db),
      creditContext(db),
    ]);
    const sub = subSnap.exists ? subSnap.data() : null;
    const proj = sub ? publicProjection(sub, settings) : null;
    const credits = await peekCredits(db, ctx).catch(() => null);
    const m = maintenanceState();

    return {
      school: { name: setupSnap.exists ? (setupSnap.data().schoolName ?? null) : null },
      plan: proj ? {
        tier: proj.tier, status: proj.status, comp: proj.comp, renewalMode: proj.renewalMode,
        endsAt: ms(proj.endsAt), trialEndsAt: ms(proj.trialEndsAt), currentPeriodEnd: ms(proj.currentPeriodEnd),
        cancelAtPeriodEnd: proj.cancelAtPeriodEnd,
      } : null,
      lastPayment: payment,
      usage: used,
      sms: credits ? { available: credits.available, includedLeft: credits.includedLeft, topup: credits.topup, granted: credits.granted } : null,
      modes: {
        payments: paystackMode() === 'live' ? 'live' : 'test',
        sms: smsMode(),
        maintenance: { on: m.on, until: m.until },
        demo: runtimeModes().demo?.on === true,
      },
      mpesa: { mode: modeOf(mpesa) },
      version: workerVersion(),
      checkedAt: Date.now(),
    };
  },
});
