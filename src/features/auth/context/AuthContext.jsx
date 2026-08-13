import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  onAuthChange,
  signIn as firebaseSignIn,
  signOut as firebaseSignOut,
} from '@services/firebase/auth';
import { auth, db } from '@services/firebase/config';
import { trackLogin } from '@services/firebase/analytics';
import { recordLoginAttempt } from '@services/api/auth';
import logger from '@utils/logger';

/**
 * Auth context — Phase 02 D7 (context split) + D1 (claims).
 *
 * Split into two providers because they change at completely different rates:
 *
 *   AuthStateContext   — user, role, tier, loading. Changes on sign-in,
 *                        sign-out and claim refresh.
 *   AuthActionsContext — signIn, signOut, refreshClaims. Memoised, so its
 *                        identity never changes after mount.
 *
 * Previously both lived in one object literal rebuilt on every render, so every
 * consumer re-rendered whenever any field moved. A component that only needs
 * `signOut` now never re-renders on a subscription-status change.
 */

const AuthStateContext = createContext(null);
const AuthActionsContext = createContext(null);

const EMPTY_CLAIMS = {
  role: null,
  tier: null,
  tierRank: 0,
  subActive: false,
  phone: null,
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [claims, setClaims] = useState(EMPTY_CLAIMS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Guards against a late token read landing after sign-out and resurrecting
  // the previous user's claims.
  const currentUidRef = useRef(null);

  const readClaims = useCallback(async (firebaseUser, forceRefresh = false) => {
    if (!firebaseUser) return EMPTY_CLAIMS;
    try {
      const result = await firebaseUser.getIdTokenResult(forceRefresh);
      const t = result.claims ?? {};
      return {
        role: t.role ?? null,
        tier: t.tier ?? null,
        tierRank: typeof t.tierRank === 'number' ? t.tierRank : 0,
        subActive: t.subActive === true,
        phone: t.phone ?? null,
      };
    } catch (err) {
      logger.warn('Failed to read ID token claims', { code: err?.code });
      return EMPTY_CLAIMS;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthChange(async (firebaseUser) => {
      currentUidRef.current = firebaseUser?.uid ?? null;

      setUser(firebaseUser);
      const next = await readClaims(firebaseUser);

      // Ignore a result that arrived after the user changed underneath us.
      if (currentUidRef.current === (firebaseUser?.uid ?? null)) {
        setClaims(next);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [readClaims]);

  /**
   * Claim propagation — Phase 02 D1.
   *
   * A custom claim set on the server does not reach the client until the ID
   * token refreshes, which can take up to an hour. The server bumps
   * `users/{uid}.claimsUpdatedAt` on every claim change; this listener reacts
   * by forcing a token refresh, cutting propagation to seconds.
   *
   * Without this, granting a tier would appear to do nothing for up to an hour.
   */
  useEffect(() => {
    if (!user?.uid) return undefined;

    const uid = user.uid;
    let lastSeen = null;

    const unsubscribe = onSnapshot(
      doc(db, 'users', uid),
      async (snap) => {
        if (!snap.exists()) return;

        const stamp = snap.data().claimsUpdatedAt?.toMillis?.() ?? null;
        if (stamp === null) return;

        // Skip the first delivery: it is the current state, not a change.
        if (lastSeen === null) {
          lastSeen = stamp;
          return;
        }
        if (stamp <= lastSeen) return;

        lastSeen = stamp;
        logger.info('Claims changed server-side; refreshing token');

        const refreshed = await readClaims(auth.currentUser, true);
        if (currentUidRef.current === uid) setClaims(refreshed);
      },
      (err) => {
        logger.warn('Claim propagation listener failed', { code: err?.code });
      }
    );

    return unsubscribe;
  }, [user?.uid, readClaims]);

  const signIn = useCallback(async (email, password) => {
    setError(null);

    const result = await firebaseSignIn(email, password);

    // Fire-and-forget: the lockout counter must never block or break sign-in.
    recordLoginAttempt(email, result.success ? 'success' : 'failure').catch(() => {});

    if (result.success) {
      logger.info('signIn: login successful');
      trackLogin();
      return { success: true };
    }

    logger.warn('signIn: login failed', { code: result.code });
    setError(result.error);
    return { success: false, error: result.error };
  }, []);

  /**
   * Secure logout — Phase 02 D3/D6.
   *
   * Clears local state as well as the Firebase session. The previous version
   * cleared only React state, so cached student data survived logout in memory.
   * The TanStack Query cache clear lands in Phase 10 when that cache exists.
   */
  const signOut = useCallback(async () => {
    logger.info('signOut: attempting logout');

    const result = await firebaseSignOut();

    if (result.success) {
      currentUidRef.current = null;
      setUser(null);
      setClaims(EMPTY_CLAIMS);
      setError(null);
      logger.info('signOut: logout successful');
    } else {
      logger.error('signOut: logout failed', result.error);
    }

    return result;
  }, []);

  const refreshClaims = useCallback(async () => {
    const refreshed = await readClaims(auth.currentUser, true);
    setClaims(refreshed);
    return refreshed;
  }, [readClaims]);

  const state = useMemo(
    () => ({
      user,
      loading,
      error,
      isAuthenticated: !!user,
      role: claims.role,
      tier: claims.tier,
      tierRank: claims.tierRank,
      subActive: claims.subActive,
      phone: claims.phone,
      // Mirrors the transitional fallback in firestore.rules: with no self
      // signup, a signed-in account with no role claim is the teacher.
      isTeacher: !!user && (claims.role === null || claims.role === 'teacher' || claims.role === 'superadmin'),
      isSuperadmin: claims.role === 'superadmin',
      isStudent: claims.role === 'student',
    }),
    [user, loading, error, claims]
  );

  const actions = useMemo(
    () => ({ signIn, signOut, refreshClaims }),
    [signIn, signOut, refreshClaims]
  );

  return (
    <AuthStateContext.Provider value={state}>
      <AuthActionsContext.Provider value={actions}>{children}</AuthActionsContext.Provider>
    </AuthStateContext.Provider>
  );
};

export const useAuthState = () => {
  const context = useContext(AuthStateContext);
  if (!context) throw new Error('useAuthState must be used within AuthProvider');
  return context;
};

export const useAuthActions = () => {
  const context = useContext(AuthActionsContext);
  if (!context) throw new Error('useAuthActions must be used within AuthProvider');
  return context;
};

/**
 * Combined accessor, kept for the existing call sites. Prefer useAuthState or
 * useAuthActions in new code — this one re-renders on any state change.
 */
export const useAuth = () => {
  const state = useAuthState();
  const actions = useAuthActions();
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
};

export { AuthStateContext, AuthActionsContext };
