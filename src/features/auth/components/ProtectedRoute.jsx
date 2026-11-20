import { Navigate, useLocation } from 'react-router-dom';
import { m } from 'framer-motion';
import { useAuthState } from '../context/AuthContext';
import { useFlag } from '@shared/config/FlagsContext';
import { usePlan } from '@features/billing/hooks/usePlan';
import { lowestPlanWith } from '@shared/constants/plans';

/**
 * Route protection — Phase 02 D5.
 *
 * Extended from "is someone signed in" to a policy:
 *
 *   <ProtectedRoute role="teacher" requires="fees" requireActive>
 *
 * `requires` is a plan feature of the SCHOOL's plan (usePlan; 013Fixes / 00),
 * never the login's own claims.
 *
 * Client-side gating is UX, never security. Every gated action is independently
 * enforced in firestore.rules and in the serverless handler; this exists so the
 * user sees a useful screen instead of a permission error.
 */

function FullPageSpinner({ label }) {
  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center">
      <m.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center"
      >
        <div
          className="spinner-border text-primary mb-3"
          style={{ width: '3rem', height: '3rem' }}
          role="status"
        >
          <span className="visually-hidden">Loading…</span>
        </div>
        <p className="text-muted">{label}</p>
      </m.div>
    </div>
  );
}

export default function ProtectedRoute({
  children,
  role = null,
  requires = null,
  requireActive = false,
}) {
  const {
    isAuthenticated,
    loading,
    role: userRole,
    isSuperadmin,
    isTeacher,
  } = useAuthState();

  const rolesEnabled = useFlag('auth.roles');
  const billingEnabled = useFlag('billing.enabled');
  const location = useLocation();
  const plan = usePlan();

  if (loading) return <FullPageSpinner label="Checking authentication…" />;

  if (!isAuthenticated) {
    // Preserve the intended destination so a deep link survives the round trip
    // through the login page.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  // With the flag off, behaviour is exactly the previous boolean check. That is
  // the rollback path: claims are additive, so an old client simply ignores them.
  if (!rolesEnabled) return children;

  if (role) {
    const satisfied =
      isSuperadmin ||
      (role === 'teacher' && isTeacher) ||
      (role === 'student' && userRole === 'student') ||
      (role === 'superadmin' && isSuperadmin);

    // A 403 page, not a redirect. Redirecting a wrong-role user to the login
    // page they are already signed in to produces a loop.
    if (!satisfied) return <Navigate to="/403" replace />;
  }

  if (requires && billingEnabled && !plan.has(requires) && !plan.pending) {
    return <Navigate to="/billing" replace state={{ upgradeTo: lowestPlanWith(requires), from: location.pathname }} />;
  }

  // Subscription lockout is enforced by BillingGuard, which sits inside the
  // billing provider and has the live status. Kept as a declared prop so route
  // definitions read as intent.
  if (requireActive && billingEnabled) {
    return children;
  }

  return children;
}
