import ProtectedRoute from '@features/auth/components/ProtectedRoute';
import BillingGuard from '@features/billing/components/BillingGuard';
import DashboardPage from '@/pages/DashboardPage';
import BillingPage from '@/pages/BillingPage';

/**
 * The guarded staff pages — Phase 13 / 08 A1. Kept out of AppRoutes so the
 * guards (and the auth context they read) are only in the staff chunks.
 */

export function StaffDashboard() {
  return (
    <ProtectedRoute role="teacher" requireActive>
      <BillingGuard>
        <DashboardPage />
      </BillingGuard>
    </ProtectedRoute>
  );
}

export function StaffBilling() {
  return (
    <ProtectedRoute role="teacher">
      <BillingPage />
    </ProtectedRoute>
  );
}
