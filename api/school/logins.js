import { createHandler } from '../_lib/handler.js';
import { getAdminAuth, getDb } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { setUserClaims, revokeUserSessions, getUserByEmail } from '../_lib/claims.js';
import { ApiError, badRequest, forbidden, notFound } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { seatState, mirrorDisabled } from '../_lib/logins.js';

/**
 * The school's dashboard logins — 013Fixes / 09 (owner, 2026-11-19).
 *
 * The superadmin makes the school's first login, the OWNER
 * (`subscription/current.ownerUid`). From then on only the owner adds,
 * disables, enables and removes the school's other logins, and sets their
 * passwords. The superadmin may too.
 *
 * Hard limit: a login is added (or re-enabled) only while the enabled
 * logins are fewer than the plan's included logins plus any extra the
 * superadmin added. Disabling or removing a login frees its seat. After a
 * downgrade, logins above the new limit keep working; only new ones wait.
 *
 * The developer login (config/platform) never takes a seat, and the owner
 * can't disable or remove it. The owner can't disable or remove themselves.
 */

const email = z.string().trim().toLowerCase().email().max(320);
const uid = z.string().trim().min(1).max(128);

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({
    action: z.literal('add'),
    email,
    password: z.string().min(12, 'Use at least 12 characters.').max(256),
    displayName: z.string().trim().min(1).max(120).optional(),
  }).strict(),
  z.object({ action: z.literal('disable'), uid }).strict(),
  z.object({ action: z.literal('enable'), uid }).strict(),
  z.object({ action: z.literal('remove'), uid, confirmEmail: z.string().trim().max(320) }).strict(),
]);

const seatsView = (s) => ({ used: s.used, included: s.included, extra: s.extra, limit: s.limit });

function seatLimitError(s) {
  return new ApiError(409, 'seat_limit', `Your plan includes ${s.limit} logins and all are in use. Contact us for more, or disable a login first.`);
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'school_logins', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const db = getDb();
    const auth = getAdminAuth();
    const seats = await seatState(db);

    if (user.role !== 'superadmin' && user.uid !== seats.ownerUid) {
      throw forbidden('Only the school owner manages logins.', 'not_owner');
    }

    const audit = (action, target, extra = {}) => tryWriteAudit({
      action, actor: user.uid, actorRole: user.role, target, context: { requestId: log.requestId, via: 'school_logins' }, ...extra,
    }, log);

    // ------------------------------------------------------------------ list
    if (body.action === 'list') {
      const users = await Promise.all(seats.teachers.map((t) => auth.getUser(t.uid).catch(() => null)));
      const logins = users.filter(Boolean).map((u) => ({
        uid: u.uid,
        email: u.email ?? null,
        displayName: u.displayName ?? null,
        disabled: u.disabled === true,
        isOwner: u.uid === seats.ownerUid,
        isDeveloper: u.uid === seats.devUid,
        createdAt: u.metadata?.creationTime ?? null,
        lastSignInAt: u.metadata?.lastSignInTime ?? null,
      })).sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || (a.email ?? '').localeCompare(b.email ?? ''));
      return { logins, seats: seatsView(seats) };
    }

    // ------------------------------------------------------------------- add
    if (body.action === 'add') {
      if (seats.used >= seats.limit) throw seatLimitError(seats);
      if (await getUserByEmail(body.email)) throw badRequest('A login with that email already exists.', 'email_taken');

      const created = await auth.createUser({
        email: body.email, password: body.password, displayName: body.displayName ?? 'Teacher', emailVerified: true,
      });
      // The school's plan applies to every login (013Fixes / 00): no plan claim.
      await setUserClaims(created.uid, { role: 'teacher', phone: null });
      await mirrorDisabled(db, created.uid, false);
      log.info('School login added');
      await audit('school.login_added', created.uid, { after: { role: 'teacher' } });
      return { ok: true, uid: created.uid, seats: seatsView({ ...seats, used: seats.used + 1 }) };
    }

    // ------------------------------------------------- the target must be one of the school's logins
    const target = seats.teachers.find((t) => t.uid === body.uid);
    if (!target) throw notFound('That login is not one of this school\'s.', 'not_found');
    if (body.uid === seats.devUid) throw forbidden('This login belongs to the platform and can\'t be changed here.', 'developer_login');
    if (body.uid === user.uid || body.uid === seats.ownerUid) {
      throw forbidden('The owner\'s own login can\'t be disabled or removed here.', 'owner_login');
    }

    // ------------------------------------------------------ disable / enable
    if (body.action === 'disable' || body.action === 'enable') {
      const disabled = body.action === 'disable';
      if (!disabled && target.disabled && seats.used >= seats.limit) throw seatLimitError(seats);
      await auth.updateUser(body.uid, { disabled });
      if (disabled) await revokeUserSessions(body.uid);
      await mirrorDisabled(db, body.uid, disabled);
      log.info(`School login ${body.action}d`);
      await audit(disabled ? 'school.login_disabled' : 'school.login_enabled', body.uid, {
        before: { disabled: target.disabled }, after: { disabled },
      });
      const used = seats.used + (target.disabled === disabled ? 0 : (disabled ? -1 : 1));
      return { ok: true, disabled, seats: seatsView({ ...seats, used }) };
    }

    // ---------------------------------------------------------------- remove
    const login = await auth.getUser(body.uid);
    if ((body.confirmEmail ?? '').toLowerCase() !== (login.email ?? '').toLowerCase()) {
      throw badRequest('Type the login\'s email address exactly to remove it.', 'confirmation_mismatch');
    }
    await auth.deleteUser(body.uid);
    await db.doc(`users/${body.uid}`).delete().catch(() => {});
    log.warn('School login removed');
    await audit('school.login_removed', body.uid, {
      before: { disabled: target.disabled },
      context: { requestId: log.requestId, via: 'school_logins', note: 'Login removed; no student or fee data is touched.' },
    });
    return { ok: true, removed: body.uid, seats: seatsView({ ...seats, used: seats.used - (target.disabled ? 0 : 1) }) };
  },
});
