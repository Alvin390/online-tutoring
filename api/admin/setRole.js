import { createHandler } from '../_lib/handler.js';
import { z, roleSchema, tierSchema, phoneSchema } from '../_lib/validate.js';
import { setUserClaims, getUserByEmail, revokeUserSessions } from '../_lib/claims.js';
import { badRequest, notFound, forbidden } from '../_lib/errors.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';

/**
 * Role and tier assignment — Phase 02 D2. Superadmin only.
 *
 * This is the most powerful endpoint in the deployment: it can make any account
 * a superadmin. Consequently it is the most heavily audited, and it refuses the
 * two operations that would let a mistake become unrecoverable:
 *
 *   - a superadmin cannot demote themselves (which could leave the deployment
 *     with no superadmin at all)
 *   - granting a tier without payment is allowed, per your Q12 answer, but is
 *     recorded with `grantedBySuperadmin` so the billing cron skips the account
 *     rather than expiring a comped subscription
 */

const schema = z
  .object({
    email: z.string().trim().email().max(320),
    role: roleSchema,
    tier: tierSchema.nullable().optional(),
    phone: phoneSchema.optional(),
    revokeSessions: z.boolean().optional(),
  })
  .strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  rateLimit: { bucket: 'admin_set_role', limit: 20, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const { email, role, tier = null, phone, revokeSessions = false } = body;

    const target = await getUserByEmail(email);
    if (!target) throw notFound('No account exists with that email address.');

    if (target.uid === user.uid && role !== 'superadmin') {
      throw forbidden(
        'You cannot remove your own superadmin role. Grant it to another account first.',
        'self_demotion'
      );
    }

    if (role === 'student' && !phone) {
      throw badRequest('A student role requires the phone number it is bound to.');
    }

    const before = target.customClaims ?? {};

    const claims = { role, tier, phone: role === 'student' ? phone : null };
    const after = await setUserClaims(target.uid, claims);

    // Revocation forces re-authentication. Only on request, because it is
    // disruptive: a routine tier change should not sign the teacher out.
    if (revokeSessions) await revokeUserSessions(target.uid);

    log.info('Role granted', { role, tier, revoked: revokeSessions });

    await tryWriteAudit(
      {
        action: AuditAction.ROLE_GRANTED,
        actor: user.uid,
        actorRole: user.role,
        target: target.uid,
        before,
        after,
        context: { requestId: log.requestId, revokeSessions },
      },
      log
    );

    return {
      ok: true,
      uid: target.uid,
      claims: after,
      // The client must refresh its token to see this. The claimsUpdatedAt bump
      // written by setUserClaims triggers that automatically.
      note: 'Claims take effect on the next ID token refresh (seconds).',
    };
  },
});
