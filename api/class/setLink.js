import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, sessionSchema } from '../_lib/validate.js';
import { parseClassLink } from '../_lib/classLink.js';
import { badRequest } from '../_lib/errors.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';

/**
 * Save a class link — Phase 04 Part B.
 *
 * The server copy of `parseClassLink` runs HERE, and this is the copy that
 * counts. The teacher's browser validates as they type so they get an
 * immediate error, but a client check is advice, not a control.
 *
 * Storing `result.url` (the re-serialised value) rather than the raw input
 * means what is stored is exactly what was validated — no trailing whitespace,
 * no unnormalised encoding, nothing that could parse differently on the way
 * back out.
 */

const schema = z
  .object({
    session: sessionSchema,
    url: z.string().trim().min(1).max(2048),
  })
  .strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'class_set_link', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const { session, url } = body;

    const result = parseClassLink(url);
    if (!result.valid) throw badRequest(result.error, 'invalid_class_link');

    const db = getDb();
    const ref = db.doc('config/zoomLinks');
    const before = (await ref.get()).data() ?? {};

    await ref.set(
      {
        [session]: result.url,
        [`${session}Provider`]: result.provider,
        [`${session}LastUpdated`]: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    log.info('Class link updated', { session, provider: result.provider });

    await tryWriteAudit(
      {
        action: AuditAction.CLASS_LINK_UPDATED,
        actor: user.uid,
        actorRole: user.role,
        target: `config/zoomLinks#${session}`,
        // The link itself is not a secret, but it is an access credential —
        // record that it changed and to which provider, not the URL.
        before: { provider: before[`${session}Provider`] ?? null, hadLink: Boolean(before[session]) },
        after: { provider: result.provider, hadLink: true },
        context: { requestId: log.requestId },
      },
      log
    );

    return { ok: true, session, provider: result.provider, url: result.url };
  },
});
