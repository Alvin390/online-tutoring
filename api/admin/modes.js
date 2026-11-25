import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { ApiError } from '../_lib/errors.js';
import { paystackMode, paystackModeSource, smsMode, smsModeSource } from '../_lib/mode.js';
import { hasLivePaystackKeys } from '../_lib/paystack.js';
import { refreshRuntimeModes, writeRuntimeModes } from '../_lib/runtimeModes.js';
import { invalidateBootstrap } from '../_lib/publicBootstrap.js';

/**
 * Superadmin → Settings → Modes — 013Fixes / 33-35 (owner answer 4).
 *
 *   status       the switches in force and where each comes from
 *   setPayments  Paystack 'live' | 'test' (M-Pesa STK has its own setting).
 *                To live: only with live keys configured. To test while the
 *                school is in a PAID period: only with confirm "TEST".
 *   setSms       'real' | 'fake' (33b): fake sends nothing and uses no units.
 *
 * Every change is audited and takes effect at once on this isolate, within
 * 30 s elsewhere (config/mode is read once per isolate per 30 s), and within
 * about a minute on the screens (the public bootstrap's cache).
 */

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({
    action: z.literal('setPayments'),
    mode: z.enum(['live', 'test']),
    confirm: z.string().max(10).optional(),
  }).strict(),
  z.object({ action: z.literal('setSms'), mode: z.enum(['real', 'fake']) }).strict(),
]);

/** In a period the school paid for (not a gift or a trial), and not over. */
async function inPaidPeriod(db) {
  const snap = await db.doc('subscription/current').get();
  const sub = snap.exists ? snap.data() : null;
  if (!sub || sub.grantedBySuperadmin === true || sub.status !== 'active') return false;
  const end = sub.currentPeriodEnd?.toMillis?.() ?? (sub.currentPeriodEnd instanceof Date ? sub.currentPeriodEnd.getTime() : null);
  return end != null && end > Date.now();
}

async function view(db) {
  return {
    payments: {
      mode: paystackMode() === 'live' ? 'live' : 'test',
      source: paystackModeSource(),
      liveKeys: hasLivePaystackKeys(),
    },
    sms: { mode: smsMode(), source: smsModeSource() },
    paidPeriod: await inPaidPeriod(db),
  };
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  rateLimit: { bucket: 'admin_modes', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log, waitUntil }) => {
    const db = getDb();
    await refreshRuntimeModes(db, { force: true });
    if (body.action === 'status') return view(db);

    const changed = async (patch, action, before, after) => {
      await writeRuntimeModes(db, patch);
      invalidateBootstrap();
      waitUntil(tryWriteAudit({
        action, actor: user.uid, actorRole: user.role, target: 'config/mode',
        before, after, context: { requestId: log.requestId },
      }, log));
      log.info('Mode changed', { action, ...after });
      return { ok: true, ...(await view(db)) };
    };

    if (body.action === 'setSms') {
      return changed({ sms: body.mode }, 'mode.sms_changed', { mode: smsMode() }, { mode: body.mode });
    }

    const before = paystackMode() === 'live' ? 'live' : 'test';
    if (body.mode === 'live' && !hasLivePaystackKeys()) {
      throw new ApiError(409, 'no_live_keys', 'There are no live Paystack keys in the server settings yet.');
    }
    if (body.mode === 'test' && before === 'live' && body.confirm !== 'TEST' && (await inPaidPeriod(db))) {
      throw new ApiError(409, 'confirm_required', 'The school is in a paid period. Type TEST to switch payments to test.');
    }
    return changed({ payments: body.mode }, 'mode.payments_changed', { mode: before }, { mode: body.mode });
  },
});
