import { getAdminAuth } from './firebaseAdmin.js';
import { forbidden, unauthorized } from './errors.js';

/**
 * Authentication and authorization for serverless handlers — Phase 01 D4.
 *
 * The Admin SDK bypasses firestore.rules, so every handler that touches the
 * database is on its own for authorization. This module is that authorization.
 * A handler that skips it has no protection at all.
 */

export const TIER_RANK = {
  bronze: 1,
  silver: 2,
  gold: 3,
};

export const ROLE_RANK = {
  student: 1,
  teacher: 2,
  superadmin: 3,
};

function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim();
}

/**
 * Verifies the caller's Firebase ID token.
 *
 * `checkRevoked: true` costs one extra lookup but means a signed-out or
 * disabled account stops working immediately rather than at token expiry, up
 * to an hour later. On any endpoint that changes state that hour matters.
 */
export async function authenticate(req, { checkRevoked = true } = {}) {
  const token = bearerToken(req);
  if (!token) throw unauthorized('Sign in to continue.');

  try {
    const decoded = await getAdminAuth().verifyIdToken(token, checkRevoked);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      // Absent role means an account provisioned before claims existed. It is
      // NOT treated as a teacher here — unlike firestore.rules, which needs a
      // transitional fallback to keep the dashboard alive during cutover. A
      // serverless handler is new code with no legacy callers, so it can hold
      // the stricter line from day one.
      role: decoded.role ?? null,
      tier: decoded.tier ?? null,
      tierRank: decoded.tierRank ?? 0,
      subActive: decoded.subActive === true,
      phone: decoded.phone ?? null,
      token: decoded,
    };
  } catch (err) {
    if (err?.code === 'auth/id-token-revoked') {
      throw unauthorized('Your session has ended. Please sign in again.', 'token_revoked');
    }
    if (err?.code === 'auth/id-token-expired') {
      throw unauthorized('Your session has expired. Please sign in again.', 'token_expired');
    }
    throw unauthorized('Sign in to continue.');
  }
}

/**
 * Role gate. Hierarchical: a superadmin satisfies a `teacher` requirement,
 * because there is no support scenario where the owner should be locked out of
 * their own customer's dashboard.
 */
export function requireRole(user, required) {
  const have = ROLE_RANK[user?.role] ?? 0;
  const need = ROLE_RANK[required] ?? Infinity;

  // 'student' is a lateral role, not a lower rung of staff: a teacher is not a
  // student and must not satisfy a student-scoped endpoint, which would let
  // them act on a student's behalf.
  if (required === 'student') {
    if (user?.role !== 'student') throw forbidden('This endpoint is for students.');
    return user;
  }

  if (have < need) throw forbidden('You do not have permission to do that.');
  return user;
}

export function requireSuperadmin(user) {
  if (user?.role !== 'superadmin') {
    throw forbidden('Superadmin access required.');
  }
  return user;
}

/**
 * Tier gate, claim-based fast path.
 *
 * Phase 03 adds a second check against `subscription/current` for money-critical
 * paths — claims can be up to an hour stale, so they are the fast path and the
 * document is the authority. For feature gating, an hour of stale generosity
 * after a downgrade is an acceptable trade against a Firestore read on every
 * request.
 */
export function requireTier(user, minimumTier) {
  if (user?.role === 'superadmin') return user;

  const need = TIER_RANK[minimumTier] ?? Infinity;
  const have = user?.tierRank ?? 0;

  if (have < need) {
    throw forbidden(
      `This feature requires the ${minimumTier} plan.`,
      'tier_required'
    );
  }
  return user;
}

/** Object-level check: this token is bound to exactly this phone number. */
export function requireOwnPhone(user, phone) {
  if (user?.role === 'teacher' || user?.role === 'superadmin') return user;
  if (user?.role === 'student' && user.phone && user.phone === phone) return user;
  throw forbidden('You can only access your own record.');
}
