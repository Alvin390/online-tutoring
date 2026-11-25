import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { badRequest } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';
import {
  readBillingSettings, saveBillingSettings, billingSettingsSchema, mergeBillingSettings, billingSettingsProblem,
} from '../_lib/billingSettings.js';

/**
 * Superadmin billing — 013Fixes / 18.
 *
 *   settings       the billing settings (config/billing over the defaults)
 *   saveSettings   change them: validated, audited
 */

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('settings') }).strict(),
  z.object({ action: z.literal('saveSettings'), settings: billingSettingsSchema }).strict(),
]);

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  rateLimit: { bucket: 'admin_billing', limit: 300, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log, waitUntil }) => {
    const db = getDb();

    if (body.action === 'settings') return { settings: await readBillingSettings(db) };

    // saveSettings
    const before = await readBillingSettings(db);
    const next = mergeBillingSettings({ ...before, ...body.settings });
    const problem = billingSettingsProblem(next);
    if (problem) throw badRequest(problem, 'bad_settings');
    const saved = await saveBillingSettings(db, body.settings, user.uid);
    waitUntil(tryWriteAudit({
      action: 'billing.settings_changed', actor: user.uid, actorRole: user.role, target: 'config/billing',
      before, after: saved, context: { requestId: log.requestId },
    }, log));
    log.info('Billing settings changed');
    return { ok: true, settings: saved };
  },
});
