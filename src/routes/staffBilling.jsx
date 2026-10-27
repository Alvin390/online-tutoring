import ProtectedRoute from '@features/auth/components/ProtectedRoute';
import BillingPage from '@/pages/BillingPage';

/**
 * The guarded billing page — Phase 13 / 08 A1; its own module since
 * 001Fixes / 04 (see staffDashboard.jsx). Deliberately not behind
 * BillingGuard: it is the only page that can resolve a lockout.
 */
export default function StaffBilling() {
  return (
    <ProtectedRoute role="teacher">
      <BillingPage />
    </ProtectedRoute>
  );
}
