import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, sessionSchema } from '../_lib/validate.js';
import { setSessionLink } from '../_lib/sessions.js';

/**
 * Sets a session's class link — Phase 04 Part B, single-store since Phase 13 / 02.
 *
 * Used to write `config/zoomLinks[session]`, while /api/class/link preferred
 * `sessions/{s}/private/classLink` — so after a seed, every link the teacher
 * saved from the dashboard was silently ignored (validated: students kept
 * receiving the seeded link). Both write paths now go through setSessionLink,
 * which writes ONLY the private document. The URL of this endpoint is kept so
 * existing clients keep working.
 */

const schema = z
  .object({
    session: sessionSchema,
    url: z.string().trim().min(1).max(2048),
  })
  .strict();

export default createHandler({
  // Phase 13 / 02 D6: every session slug in the body must exist.
  sessions: 'any',
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'class_set_link', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const { session, url } = body;

    const result = await setSessionLink(getDb(), session, url, {
      actor: user.uid,
      actorRole: user.role,
      log,
      requestId: log.requestId,
    });

    log.info('Class link updated', { session, provider: result.provider });

    return { ok: true, session, provider: result.provider, url: result.url };
  },
});
