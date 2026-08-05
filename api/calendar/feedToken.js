import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, sessionSchema, phoneSchema } from '../_lib/validate.js';
import { sha256 } from '../_lib/crypto.js';
import { issueFeedToken } from './export.js';
import { badRequest } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';

/**
 * Issue and revoke calendar feed tokens — Phase 07 D5.
 *
 * Teacher only. A feed URL is a bearer credential in a query string: it will end
 * up in a student's browser history, possibly in a shared family calendar, and
 * quite likely in a WhatsApp message. So revocation is a first-class operation
 * rather than an afterthought, and the token is scoped read-only to one
 * student's visible events.
 */

const schema = z
  .object({
    action: z.enum(['issue', 'revoke', 'list']),
    role: z.enum(['teacher', 'student']).optional(),
    session: sessionSchema.optional(),
    phone: phoneSchema.optional(),
    token: z.string().trim().max(200).optional(),
    tokenId: z.string().trim().max(80).optional(),
  })
  .strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  tier: 'silver',
  schema,
  rateLimit: { bucket: 'calendar_feed_token', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const db = getDb();

    if (body.action === 'issue') {
      const role = body.role ?? 'student';
      if (role === 'student' && !body.session) {
        throw badRequest('A student feed must be scoped to a session.');
      }

      const token = await issueFeedToken(db, {
        role,
        session: body.session ?? null,
        phone: body.phone ?? null,
        issuedBy: user.uid,
      });

      const base = process.env.PUBLIC_BASE_URL ?? '';
      log.info('Calendar feed token issued', { role, session: body.session ?? null });

      await tryWriteAudit(
        { action: 'calendar.feed_token_issued', actor: user.uid, actorRole: user.role,
          target: sha256(token).slice(0, 16), context: { requestId: log.requestId, role } },
        log
      );

      return {
        ok: true,
        // Shown ONCE. Only the hash is stored, so this cannot be recovered
        // later — a lost feed URL is reissued, never looked up.
        url: `${base}/api/calendar/export?token=${encodeURIComponent(token)}`,
        tokenId: sha256(token).slice(0, 16),
      };
    }

    if (body.action === 'revoke') {
      // Accepts either the raw token or the short ID shown in the list, so the
      // teacher can revoke from whichever they still have.
      let docId = null;

      if (body.token) {
        docId = sha256(body.token);
      } else if (body.tokenId) {
        const matches = await db.collection('calendar/tokens/items').get();
        const found = matches.docs.find((d) => d.id.startsWith(body.tokenId));
        docId = found?.id ?? null;
      }

      if (!docId) throw badRequest('Which feed are you revoking?');

      await db.doc(`calendar/tokens/items/${docId}`).set(
        { revokedAt: FieldValue.serverTimestamp(), revokedBy: user.uid },
        { merge: true }
      );

      log.info('Calendar feed token revoked');
      await tryWriteAudit(
        { action: 'calendar.feed_token_revoked', actor: user.uid, actorRole: user.role,
          target: docId.slice(0, 16), context: { requestId: log.requestId } },
        log
      );

      return { ok: true, revoked: docId.slice(0, 16) };
    }

    // list
    const snapshot = await db.collection('calendar/tokens/items').get();
    return {
      ok: true,
      tokens: snapshot.docs.map((d) => ({
        tokenId: d.id.slice(0, 16),
        role: d.data().role,
        session: d.data().session,
        issuedAt: d.data().issuedAt?.toDate?.()?.toISOString() ?? null,
        revokedAt: d.data().revokedAt?.toDate?.()?.toISOString() ?? null,
        lastAccessedDay: d.data().lastAccessedDay ?? null,
      })),
    };
  },
});
