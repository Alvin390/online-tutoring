import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { darajaMode } from '../_lib/mode.js';
import { _resetTokenCache, credentialSource } from '../_lib/daraja.js';
import { keysView, saveKeys, clearKeys, SECRET_FIELDS } from '../_lib/darajaKeys.js';

/**
 * Superadmin → M-Pesa payments (STK) — 013Fixes / 29 (owner answer 5).
 *
 *   status  the mode, where the keys in use come from, and the saved keys as
 *           the last 4 characters of each and when (never a value)
 *   save    the school's LIVE keys, encrypted; write-only; audited without values
 *   clear   remove them (live mode falls back to the environment's, if any)
 */

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({
    action: z.literal('save'),
    consumerKey: z.string().trim().min(1).max(200),
    consumerSecret: z.string().trim().min(1).max(200),
    passkey: z.string().trim().min(1).max(300),
    // A wrong type means the prompt never reaches the phone (docs/STK_PUSH_PILOT.md).
    shortCode: z.string().trim().regex(/^\d{5,8}$/, 'The till or paybill number is 5 to 8 digits.'),
    shortCodeType: z.enum(['till', 'paybill']),
  }).strict(),
  z.object({ action: z.literal('clear') }).strict(),
]);

async function view(db) {
  return { mode: darajaMode(), source: await credentialSource().catch(() => null), keys: await keysView(db) };
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  rateLimit: { bucket: 'admin_daraja', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log, waitUntil }) => {
    const db = getDb();

    if (body.action === 'status') return view(db);

    if (body.action === 'save') {
      await saveKeys(db, body, user.uid);
      // A token issued for the old keys must not be reused with the new ones.
      _resetTokenCache();
      waitUntil(tryWriteAudit({
        action: 'mpesa.keys_saved', actor: user.uid, actorRole: user.role, target: 'config/darajaCredentials',
        // Which fields and the type; never a value, not even the last 4.
        after: { fields: SECRET_FIELDS, shortCodeType: body.shortCodeType }, context: { requestId: log.requestId },
      }, log));
      log.info('M-Pesa keys saved', { shortCodeType: body.shortCodeType });
      return { ok: true, ...(await view(db)) };
    }

    // clear
    await clearKeys(db);
    _resetTokenCache();
    waitUntil(tryWriteAudit({
      action: 'mpesa.keys_cleared', actor: user.uid, actorRole: user.role, target: 'config/darajaCredentials',
      context: { requestId: log.requestId },
    }, log));
    log.info('M-Pesa keys cleared');
    return { ok: true, ...(await view(db)) };
  },
});
