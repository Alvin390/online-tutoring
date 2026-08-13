import { getAdminAuth, getDb, FieldValue } from './firebaseAdmin.js';
import { TIER_RANK } from './auth.js';

/**
 * Custom claims — Phase 02 D1.
 *
 * Claims ride inside the ID token, so Firestore rules can read them with zero
 * extra document reads. That is what makes role and tier gating cheap enough to
 * apply on every rule evaluation.
 *
 * Claim shape:
 *   role      'superadmin' | 'teacher' | 'student'
 *   tier      'bronze' | 'silver' | 'gold' | null
 *   tierRank  0 | 1 | 2 | 3
 *   subActive boolean
 *   phone     E.164 string, students only
 *
 * THE TRAP: a changed claim does not reach the client until its ID token
 * refreshes, which can take up to an hour. Two mitigations, both required and
 * both implemented here:
 *
 *   1. Every claim change bumps `users/{uid}.claimsUpdatedAt`. The client
 *      subscribes to its own user document and calls getIdToken(true) when it
 *      moves — propagation in seconds instead of up to an hour.
 *
 *   2. Rules never trust the claim alone for money-critical decisions. Claims
 *      are the fast path; `subscription/current` is the authority. See
 *      requireActiveSubscription in ./subscription.js.
 *
 * Firebase caps custom claims at 1000 bytes total. The shape above is ~120
 * bytes; do not let it grow into a general-purpose user profile.
 */

export async function setUserClaims(uid, claims) {
  const auth = getAdminAuth();
  const db = getDb();

  const existing = (await auth.getUser(uid)).customClaims ?? {};
  const next = { ...existing, ...claims };

  // Normalise: tierRank is derived, never supplied, so it cannot drift out of
  // step with tier.
  if ('tier' in next) {
    next.tierRank = next.tier ? (TIER_RANK[next.tier] ?? 0) : 0;
  }

  // Strip nulls — Firebase stores them, and `'key' in token` then reports true
  // for a claim that is semantically absent.
  for (const key of Object.keys(next)) {
    if (next[key] === null || next[key] === undefined) delete next[key];
  }

  await auth.setCustomUserClaims(uid, next);

  // The propagation bump. Written after the claim, so a client that reacts to
  // it is guaranteed to fetch a token containing the new value.
  await db.collection('users').doc(uid).set(
    {
      claimsUpdatedAt: FieldValue.serverTimestamp(),
      role: next.role ?? null,
      tier: next.tier ?? null,
    },
    { merge: true }
  );

  return next;
}

/**
 * Forces every existing token for this user to be rejected.
 *
 * Used when revoking access outright (role removal, account compromise). It is
 * heavier than a claim bump — the user must re-authenticate — so it is reserved
 * for revocation rather than routine tier changes.
 */
export async function revokeUserSessions(uid) {
  await getAdminAuth().revokeRefreshTokens(uid);
}

export async function getUserByEmail(email) {
  try {
    return await getAdminAuth().getUserByEmail(email);
  } catch (err) {
    if (err?.code === 'auth/user-not-found') return null;
    throw err;
  }
}
