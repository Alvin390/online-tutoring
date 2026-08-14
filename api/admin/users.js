import { createHandler } from '../_lib/handler.js';
import { getAdminAuth, getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, roleSchema, tierSchema } from '../_lib/validate.js';
import { setUserClaims, revokeUserSessions, getUserByEmail } from '../_lib/claims.js';
import { badRequest, notFound, forbidden } from '../_lib/errors.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';
import { TIER_RANK } from '../_lib/auth.js';
import { STATUS, GRACE_PERIOD_MS, publicProjection } from '../_lib/subscription.js';

/**
 * User administration — superadmin only.
 *
 * Everything the console can do lives here, behind one role check, so there is
 * a single place to audit "what can the superadmin actually do".
 *
 * Two refusals are built in and are not configurable:
 *
 *   - The superadmin cannot demote, disable or delete THEMSELVES. Doing so
 *     could leave the deployment with no superadmin and no way to make
 *     another, since `seed:superadmin` needs a service account and shell
 *     access.
 *   - Deletion requires the target's email typed back exactly. It is
 *     irreversible and leaves their students' data behind.
 */

const schema = z
  .object({
    action: z.enum([
      'list',
      'createTeacher',
      'setRole',
      'setTier',
      'startTrial',
      'expireToGrace',
      'expireNow',
      'disable',
      'enable',
      'delete',
    ]),
    uid: z.string().trim().max(128).optional(),
    email: z.string().trim().email().max(320).optional(),
    password: z.string().min(12).max(256).optional(),
    displayName: z.string().trim().max(120).optional(),
    role: roleSchema.optional(),
    tier: tierSchema.nullable().optional(),
    trialDays: z.number().int().min(1).max(90).optional(),
    // Must equal the target's email for a delete to proceed.
    confirmEmail: z.string().trim().max(320).optional(),
  })
  .strict();

function projectUser(user) {
  const claims = user.customClaims ?? {};
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    disabled: user.disabled === true,
    role: claims.role ?? null,
    tier: claims.tier ?? null,
    tierRank: claims.tierRank ?? 0,
    phone: claims.phone ?? null,
    createdAt: user.metadata?.creationTime ?? null,
    lastSignInAt: user.metadata?.lastSignInTime ?? null,
  };
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  rateLimit: { bucket: 'admin_users', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const auth = getAdminAuth();
    const db = getDb();
    const { action } = body;

    // ------------------------------------------------------------------ list
    if (action === 'list') {
      const page = await auth.listUsers(1000);

      // Students are excluded: they are created automatically on phone
      // verification, there can be hundreds, and they are managed from the
      // dashboard rather than here.
      const staff = page.users
        .map(projectUser)
        .filter((u) => u.role !== 'student')
        .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));

      const studentCount = page.users.length - staff.length;

      const subSnap = await db.doc('subscription/current').get();
      const subscription = subSnap.exists
        ? {
            tier: subSnap.data().tier ?? null,
            status: subSnap.data().status ?? null,
            renewalMode: subSnap.data().renewalMode ?? null,
            grantedBySuperadmin: subSnap.data().grantedBySuperadmin === true,
            currentPeriodEnd: subSnap.data().currentPeriodEnd?.toDate?.()?.toISOString() ?? null,
            trialEndsAt: subSnap.data().trialEndsAt?.toDate?.()?.toISOString() ?? null,
          }
        : null;

      return { ok: true, users: staff, studentCount, subscription };
    }

    // --------------------------------------------------------- createTeacher
    if (action === 'createTeacher') {
      if (!body.email || !body.password) {
        throw badRequest('An email and a password of at least 12 characters are required.');
      }

      const existing = await getUserByEmail(body.email);
      if (existing) throw badRequest('An account with that email already exists.', 'email_taken');

      const created = await auth.createUser({
        email: body.email,
        password: body.password,
        displayName: body.displayName ?? 'Teacher',
        emailVerified: true,
      });

      await setUserClaims(created.uid, {
        role: 'teacher',
        tier: body.tier ?? 'bronze',
        phone: null,
      });

      log.info('Teacher account created');

      await tryWriteAudit(
        {
          action: AuditAction.ROLE_GRANTED,
          actor: user.uid,
          actorRole: user.role,
          target: created.uid,
          after: { role: 'teacher', tier: body.tier ?? 'bronze' },
          context: { requestId: log.requestId, via: 'superadmin_console' },
        },
        log
      );

      return { ok: true, uid: created.uid };
    }

    // ------------------------------------------------- expireToGrace / expireNow
    //
    // Testing affordances, and they are not cosmetic: without them the only way
    // to see a lockout is to wait for real calendar time to pass, which makes
    // the most important behaviour in the product the least testable.
    //
    // No `uid` — this deployment has ONE subscription. The action is on
    // `subscription/current`, not on a person.
    //
    // BOTH clear `grantedBySuperadmin`. That flag short-circuits the entire
    // state machine (../_lib/subscription.js:113 returns `unchanged` before any
    // other branch is considered), so leaving it set would make these buttons
    // appear to work and then change nothing on the next read.
    if (action === 'expireToGrace' || action === 'expireNow') {
      const now = Date.now();
      const toGrace = action === 'expireToGrace';

      const patch = {
        status: toGrace ? STATUS.GRACE : STATUS.EXPIRED,
        currentPeriodEnd: new Date(now),
        trialEndsAt: null,
        // The whole point: stop being comped, so the sweep and the on-read
        // check both start applying to this subscription again.
        grantedBySuperadmin: false,
        graceEndsAt: toGrace ? new Date(now + GRACE_PERIOD_MS) : null,
        updatedAt: FieldValue.serverTimestamp(),
      };

      const ref = db.doc('subscription/current');
      const subscriptionBefore = (await ref.get()).data() ?? null;
      await ref.set(patch, { merge: true });

      // Keep the public projection in step, because the teacher's dashboard
      // listens to that document rather than to this one.
      const after = { ...((await ref.get()).data() ?? {}) };
      await db.doc('subscription/public').set(publicProjection(after) ?? {}, { merge: false });

      log.warn('Subscription expired by superadmin', {
        to: patch.status,
        graceHours: toGrace ? GRACE_PERIOD_MS / 3600000 : 0,
      });

      await tryWriteAudit(
        { action: AuditAction.SUBSCRIPTION_CHANGED, actor: user.uid, actorRole: user.role,
          target: 'subscription:current',
          before: { status: subscriptionBefore?.status ?? null,
                    grantedBySuperadmin: subscriptionBefore?.grantedBySuperadmin === true },
          after: { status: patch.status },
          context: { requestId: log.requestId, via: 'superadmin_console', reason: 'manual_expiry' } },
        log
      );

      return {
        ok: true,
        status: patch.status,
        graceEndsAt: toGrace ? new Date(now + GRACE_PERIOD_MS).toISOString() : null,
      };
    }

    // Everything below needs a target.
    if (!body.uid) throw badRequest('Which account?');

    let target;
    try {
      target = await auth.getUser(body.uid);
    } catch {
      throw notFound('That account no longer exists.');
    }

    const isSelf = target.uid === user.uid;

    // ------------------------------------------------------------- setRole
    if (action === 'setRole') {
      if (!body.role) throw badRequest('Which role?');
      if (isSelf && body.role !== 'superadmin') {
        throw forbidden(
          'You cannot remove your own superadmin role. Grant it to another account first.',
          'self_demotion'
        );
      }

      const before = target.customClaims ?? {};
      const after = await setUserClaims(target.uid, {
        role: body.role,
        tier: body.tier ?? before.tier ?? null,
      });

      await tryWriteAudit(
        { action: AuditAction.ROLE_GRANTED, actor: user.uid, actorRole: user.role,
          target: target.uid, before, after,
          context: { requestId: log.requestId, via: 'superadmin_console' } },
        log
      );

      return { ok: true, claims: after };
    }

    // ------------------------------------------------------------- setTier
    if (action === 'setTier') {
      if (body.tier === undefined) throw badRequest('Which tier?');

      const before = target.customClaims ?? {};
      const after = await setUserClaims(target.uid, { tier: body.tier });

      // Keep the subscription document in step, and mark it comped so the
      // billing cron skips it rather than expiring a tier nobody paid for.
      if (body.tier) {
        const now = Date.now();
        await db.doc('subscription/current').set(
          {
            tier: body.tier,
            status: STATUS.ACTIVE,
            grantedBySuperadmin: true,
            renewalMode: 'manual',
            currentPeriodStart: new Date(now),
            currentPeriodEnd: new Date(now + 365 * 24 * 60 * 60 * 1000),
            graceEndsAt: null,
            cancelAtPeriodEnd: false,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      log.info('Tier changed by superadmin', { tier: body.tier });

      await tryWriteAudit(
        { action: AuditAction.TIER_GRANTED_BY_SUPERADMIN, actor: user.uid, actorRole: user.role,
          target: target.uid,
          before: { tier: before.tier ?? null }, after: { tier: body.tier },
          context: { requestId: log.requestId, via: 'superadmin_console' } },
        log
      );

      return { ok: true, claims: after, tierRank: TIER_RANK[body.tier] ?? 0 };
    }

    // ---------------------------------------------------------- startTrial
    if (action === 'startTrial') {
      const days = body.trialDays ?? 14;
      const tier = body.tier ?? 'gold';
      const now = Date.now();
      const endsAt = new Date(now + days * 24 * 60 * 60 * 1000);

      await setUserClaims(target.uid, { tier });

      await db.doc('subscription/current').set(
        {
          tier,
          status: STATUS.TRIALING,
          trialEndsAt: endsAt,
          currentPeriodStart: new Date(now),
          currentPeriodEnd: endsAt,
          // NOT comped: a trial is meant to expire, so the cron must sweep it.
          grantedBySuperadmin: false,
          renewalMode: 'manual',
          graceEndsAt: null,
          cancelAtPeriodEnd: false,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      log.info('Trial started', { tier, days });

      await tryWriteAudit(
        { action: AuditAction.SUBSCRIPTION_CHANGED, actor: user.uid, actorRole: user.role,
          target: target.uid, after: { status: 'trialing', tier, days },
          context: { requestId: log.requestId, via: 'superadmin_console' } },
        log
      );

      return { ok: true, tier, trialEndsAt: endsAt.toISOString() };
    }

    // ------------------------------------------------------ disable / enable
    if (action === 'disable' || action === 'enable') {
      const disabled = action === 'disable';

      if (disabled && isSelf) {
        throw forbidden('You cannot disable your own account.', 'self_disable');
      }

      await auth.updateUser(target.uid, { disabled });
      // Revoking on disable makes it immediate rather than waiting for the
      // current ID token to expire, which can be up to an hour.
      if (disabled) await revokeUserSessions(target.uid);

      log.info(`Account ${action}d`);

      await tryWriteAudit(
        { action: disabled ? 'auth.account_disabled' : 'auth.account_enabled',
          actor: user.uid, actorRole: user.role, target: target.uid,
          before: { disabled: target.disabled === true }, after: { disabled },
          context: { requestId: log.requestId, via: 'superadmin_console' } },
        log
      );

      return { ok: true, disabled };
    }

    // ----------------------------------------------------------------- delete
    if (action === 'delete') {
      if (isSelf) {
        throw forbidden('You cannot delete your own account.', 'self_delete');
      }

      // Typed confirmation. Irreversible, and it leaves their students' data
      // behind — so a mis-click must not be enough.
      if (!body.confirmEmail || body.confirmEmail.toLowerCase() !== (target.email ?? '').toLowerCase()) {
        throw badRequest(
          "Type the account's email address exactly to confirm deletion.",
          'confirmation_mismatch'
        );
      }

      const before = projectUser(target);
      await auth.deleteUser(target.uid);
      await db.collection('users').doc(target.uid).delete().catch(() => {});

      log.warn('Account permanently deleted');

      await tryWriteAudit(
        { action: 'auth.account_deleted', actor: user.uid, actorRole: user.role,
          target: target.uid, before,
          context: {
            requestId: log.requestId,
            via: 'superadmin_console',
            note: 'Auth account removed. Student and ledger data under this deployment are NOT deleted.',
          } },
        log
      );

      return { ok: true, deleted: target.uid };
    }

    throw badRequest('Unknown action.');
  },
});
