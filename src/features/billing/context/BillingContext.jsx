import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@services/firebase/config';
import { useAuthState } from '@features/auth/context/AuthContext';
import { useFlag } from '@shared/config/FlagsContext';
import { getBillingStatus } from '@services/api/billing';
import logger from '@utils/logger';

/**
 * Billing state — Phase 03.
 *
 * Two sources, deliberately:
 *
 *   1. A live listener on `subscription/public` (the redacted projection), so
 *      a webhook-driven change appears without a refresh.
 *   2. One call to /api/billing/status on mount, which runs the lazy on-read
 *      state check. The listener alone would never trigger the recomputation
 *      that moves grace → locked, because nothing writes the document when a
 *      deadline merely passes.
 */

const BillingContext = createContext(null);

const EMPTY = {
  loading: true,
  billingEnabled: false,
  subscription: null,
  accessGranted: true,
  status: null,
  tier: null,
  graceEndsAt: null,
};

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function BillingProvider({ children }) {
  const { isAuthenticated, isTeacher } = useAuthState();
  const billingEnabled = useFlag('billing.enabled');
  const [state, setState] = useState(EMPTY);

  const refresh = useCallback(async () => {
    if (!isAuthenticated || !isTeacher) {
      setState({ ...EMPTY, loading: false });
      return;
    }

    try {
      const result = await getBillingStatus();
      setState({
        loading: false,
        billingEnabled: result.billingEnabled,
        subscription: result.subscription,
        accessGranted: result.accessGranted,
        status: result.subscription?.status ?? null,
        tier: result.subscription?.tier ?? null,
        graceEndsAt: result.graceEndsAt ?? toMillis(result.subscription?.graceEndsAt),
      });
    } catch (err) {
      // Fail OPEN on a status-check failure. Locking the teacher out of their
      // own dashboard because an endpoint hiccuped is a far worse outcome than
      // an extra hour of access — the cron and the next read both re-check.
      logger.warn('Billing status check failed; allowing access', { code: err?.code });
      setState((prev) => ({ ...prev, loading: false, accessGranted: true }));
    }
  }, [isAuthenticated, isTeacher]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live projection listener.
  useEffect(() => {
    if (!isAuthenticated || !isTeacher || !billingEnabled) return undefined;

    const unsubscribe = onSnapshot(
      doc(db, 'subscription', 'public'),
      (snap) => {
        if (!snap.exists()) return;
        const sub = snap.data();
        setState((prev) => ({
          ...prev,
          loading: false,
          subscription: sub,
          status: sub.status ?? null,
          tier: sub.tier ?? null,
          graceEndsAt: toMillis(sub.graceEndsAt),
        }));
      },
      (err) => logger.warn('Subscription listener failed', { code: err?.code })
    );

    return unsubscribe;
  }, [isAuthenticated, isTeacher, billingEnabled]);

  const value = useMemo(
    () => ({
      ...state,
      billingEnabled: billingEnabled && state.billingEnabled,
      isLocked: billingEnabled && state.status === 'locked',
      isExpired: billingEnabled && state.status === 'expired',
      inGrace: state.status === 'grace' || state.status === 'past_due',
      refresh,
    }),
    [state, billingEnabled, refresh]
  );

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) throw new Error('useBilling must be used within BillingProvider');
  return context;
}

export { BillingContext };
