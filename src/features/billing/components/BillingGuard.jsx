import { Navigate, useLocation } from 'react-router-dom';
import { useBilling } from '../context/BillingContext';
import GracePeriodCountdown from './GracePeriodCountdown';

/**
 * Subscription lockout — Phase 03 D6.
 *
 * Wraps routes that require an unlocked subscription. When locked, every route
 * except /billing and /logout redirects to /billing — the only page that can
 * resolve the lockout.
 *
 * Two deliberate choices:
 *
 *   - **Fails open while loading.** Rendering a lockout during the status check
 *     would flash "your account is locked" at a teacher whose account is fine.
 *     A moment of extra access is a much smaller cost than that.
 *
 *   - **Data is untouched.** Lockout is an access decision, not a deletion, and
 *     the billing page says so explicitly.
 */
export default function BillingGuard({ children }) {
  const { isLocked, isExpired, loading, billingEnabled } = useBilling();
  const location = useLocation();

  if (!billingEnabled || loading) {
    return (
      <>
        <GracePeriodCountdown />
        {children}
      </>
    );
  }

  if ((isLocked || isExpired) && location.pathname !== '/billing') {
    return <Navigate to="/billing" replace />;
  }

  return (
    <>
      <GracePeriodCountdown />
      {children}
    </>
  );
}
