import ProtectedRoute from '@features/auth/components/ProtectedRoute';
import BillingGuard from '@features/billing/components/BillingGuard';
import DashboardPage from '@/pages/DashboardPage';

/**
 * The guarded dashboard — Phase 13 / 08 A1. Kept out of AppRoutes so the
 * guards (and the auth context they read) are only in the staff chunks.
 *
 * One module per staff page (001Fixes / 04): when the dashboard and billing
 * shared a module, every dashboard visit also downloaded the whole billing
 * page (~4 KB gzipped) it does not show.
 */
export default function StaffDashboard() {
  return (
    <ProtectedRoute role="teacher" requireActive>
      <BillingGuard>
        <DashboardPage />
      </BillingGuard>
    </ProtectedRoute>
  );
}
