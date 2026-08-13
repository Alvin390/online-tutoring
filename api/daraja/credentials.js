import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { encrypt, ENCRYPTION_KEY_VERSION } from '../_lib/crypto.js';
import { getAccessToken, _resetTokenCache } from '../_lib/daraja.js';
import { badRequest } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';

/**
 * Daraja credential custody — Phase 09 D1/D7.
 *
 * Consumer key, consumer secret and passkey are third-party credentials that
 * move real money out of a real till. They:
 *
 *   - are AES-256-GCM encrypted before they touch Firestore (Phase 01 D5)
 *   - live at `integrations/daraja`, which is `allow read, write: if false` for
 *     EVERY client including the superadmin — only the Admin SDK reads it
 *   - are never returned by any endpoint, not even masked back to the teacher
 *     who typed them
 *   - are never logged
 *
 * `encryptionKeyVersion` is stored alongside so a key rotation can decrypt old
 * records with the old key rather than guessing.
 */

const schema = z
  .object({
    action: z.enum(['save', 'status', 'test']),
    // 5–7 digits per daraja_docs.txt:633.
    shortCode: z.string().trim().regex(/^\d{5,7}$/).optional(),
    shortCodeType: z.enum(['till', 'paybill']).optional(),
    environment: z.enum(['sandbox', 'production']).optional(),
    consumerKey: z.string().trim().min(10).max(200).optional(),
    consumerSecret: z.string().trim().min(10).max(200).optional(),
    passkey: z.string().trim().min(10).max(300).optional(),
  })
  .strict();

/** Shows the last four characters only, so the teacher can tell one key from another. */
function maskTail(value) {
  const s = String(value ?? '');
  return s.length <= 4 ? '••••' : `••••••••${s.slice(-4)}`;
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  tier: 'gold',
  schema,
  rateLimit: { bucket: 'daraja_credentials', limit: 30, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const db = getDb();
    const ref = db.doc('integrations/daraja');

    // ------------------------------------------------------------- status
    if (body.action === 'status') {
      const snap = await ref.get();
      if (!snap.exists) {
        return { ok: true, configured: false };
      }

      const data = snap.data();
      const baseUrl = process.env.PUBLIC_BASE_URL ?? '';

      return {
        ok: true,
        configured: true,
        shortCode: data.shortCode ?? null,
        shortCodeType: data.shortCodeType ?? null,
        environment: data.environment ?? 'sandbox',
        // Masked hints only. The plaintext is never returned, so a compromised
        // teacher session cannot exfiltrate the credentials.
        consumerKeyHint: data.consumerKeyHint ?? '••••',
        verifiedAt: data.verifiedAt?.toDate?.()?.toISOString() ?? null,
        // What the teacher pastes into the Safaricom portal.
        callbackUrl: `${baseUrl}/api/daraja/callback/${data.callbackSecret ?? ''}`,
      };
    }

    // --------------------------------------------------------------- save
    if (body.action === 'save') {
      const required = ['shortCode', 'shortCodeType', 'consumerKey', 'consumerSecret', 'passkey'];
      for (const field of required) {
        if (!body[field]) throw badRequest(`${field} is required.`);
      }

      const before = (await ref.get()).data() ?? null;

      // An unguessable path segment on the callback URL, as defence in depth
      // behind the IP allowlist. Regenerated only on first save, so re-saving
      // credentials does not invalidate a URL already registered with
      // Safaricom — which would silently break every in-flight payment.
      const callbackSecret = before?.callbackSecret
        ?? (await import('../_lib/crypto.js')).randomToken(16);

      await ref.set(
        {
          shortCode: body.shortCode,
          shortCodeType: body.shortCodeType,
          environment: body.environment ?? 'sandbox',
          consumerKeyEnc: encrypt(body.consumerKey),
          consumerSecretEnc: encrypt(body.consumerSecret),
          passkeyEnc: encrypt(body.passkey),
          consumerKeyHint: maskTail(body.consumerKey),
          encryptionKeyVersion: ENCRYPTION_KEY_VERSION,
          callbackSecret,
          // Cleared on every save: new credentials are unverified until tested.
          verifiedAt: null,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: user.uid,
        },
        { merge: true }
      );

      _resetTokenCache();

      log.info('Daraja credentials saved', {
        environment: body.environment ?? 'sandbox',
        shortCodeType: body.shortCodeType,
      });

      await tryWriteAudit(
        {
          action: 'daraja.credentials_updated',
          actor: user.uid,
          actorRole: user.role,
          target: 'integrations/daraja',
          // Never the values, not even encrypted — only that they changed.
          before: before ? { environment: before.environment, shortCode: before.shortCode } : null,
          after: { environment: body.environment ?? 'sandbox', shortCode: body.shortCode },
          context: { requestId: log.requestId },
        },
        log
      );

      const baseUrl = process.env.PUBLIC_BASE_URL ?? '';
      return {
        ok: true,
        configured: true,
        callbackUrl: `${baseUrl}/api/daraja/callback/${callbackSecret}`,
        note: 'Register this callback URL in the Safaricom portal, then run Test connection.',
      };
    }

    // --------------------------------------------------------------- test
    //
    // Catches misconfiguration at entry rather than at the first student
    // payment, which is the difference between a teacher fixing a typo now and
    // a parent's payment vanishing next week.
    const { loadCredentials } = await import('../_lib/daraja.js');

    try {
      const credentials = await loadCredentials();
      await getAccessToken(credentials);

      await ref.set(
        { verifiedAt: FieldValue.serverTimestamp(), lastTestError: null },
        { merge: true }
      );

      log.info('Daraja connection test succeeded', { environment: credentials.environment });

      return {
        ok: true,
        verified: true,
        environment: credentials.environment,
        message: `Connected to M-Pesa ${credentials.environment}.`,
      };
    } catch (err) {
      // The exact Daraja error is surfaced to the teacher — "invalid consumer
      // key" is actionable, "something went wrong" is not.
      const message = err?.message ?? 'Could not connect to M-Pesa.';
      await ref.set({ verifiedAt: null, lastTestError: message }, { merge: true });

      log.warn('Daraja connection test failed', { code: err?.code });
      return { ok: true, verified: false, message };
    }
  },
});
