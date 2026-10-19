import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import {
  getAccessToken,
  loadCredentials,
  credentialSource,
  ensureCallbackSecret,
  buildCallbackUrl,
} from '../_lib/daraja.js';
import { ApiError } from '../_lib/errors.js';

/**
 * M-Pesa (Daraja) configuration diagnostics — superadmin only.
 *
 * Phase 13 decision: the till and keys are supplied by the OPERATOR as
 * environment variables (Cloudflare Worker variables/secrets in production,
 * `.dev.vars` locally). Teachers never see or enter them — the billing-page
 * settings card was removed — and this endpoint REFUSES every attempt to save
 * credentials, whoever asks.
 *
 * What remains, for the operator only:
 *   status  whether a full credential set is present, sandbox or live, the
 *           shortcode, and the callback URL (it carries the callback secret,
 *           which is why teachers no longer get this)
 *   test    an OAuth round trip against Daraja; sends no STK push
 */

const schema = z
  .object({
    action: z.enum(['save', 'status', 'test']),
  })
  .passthrough();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  rateLimit: { bucket: 'daraja_credentials', limit: 30, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, log }) => {
    if (body.action === 'save') {
      throw new ApiError(
        409,
        'managed_by_environment',
        'M-Pesa credentials are set in the server configuration (Cloudflare variables) and cannot be changed in the app.'
      );
    }

    const db = getDb();
    const ref = db.doc('integrations/daraja');

    if (body.action === 'status') {
      let callbackUrl = null;
      try {
        callbackUrl = buildCallbackUrl(process.env.PUBLIC_BASE_URL, await ensureCallbackSecret(db));
      } catch (err) {
        log.warn('Callback URL unavailable', { reason: err?.message });
      }

      const source = await credentialSource();
      if (!source) return { ok: true, configured: false, source: null, callbackUrl };

      const creds = await loadCredentials();
      const data = (await ref.get()).data() ?? {};
      return {
        ok: true,
        configured: true,
        source,
        shortCode: creds.shortCode ?? null,
        shortCodeType: creds.shortCodeType ?? null,
        environment: creds.environment ?? 'sandbox',
        verifiedAt: data.verifiedAt?.toDate?.()?.toISOString() ?? null,
        lastTestError: data.lastTestError ?? null,
        callbackUrl,
      };
    }

    // test — catches misconfiguration before the first parent's payment does.
    try {
      const credentials = await loadCredentials();
      await getAccessToken(credentials);
      await ref.set({ verifiedAt: FieldValue.serverTimestamp(), lastTestError: null }, { merge: true });
      log.info('Daraja connection test succeeded', { environment: credentials.environment });
      return {
        ok: true,
        verified: true,
        environment: credentials.environment,
        message: `Connected to M-Pesa ${credentials.environment}.`,
      };
    } catch (err) {
      const message = err?.message ?? 'Could not connect to M-Pesa.';
      await ref.set({ verifiedAt: null, lastTestError: message }, { merge: true });
      log.warn('Daraja connection test failed', { code: err?.code });
      return { ok: true, verified: false, message };
    }
  },
});
