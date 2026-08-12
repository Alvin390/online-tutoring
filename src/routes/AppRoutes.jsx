import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import ProtectedRoute from '@features/auth/components/ProtectedRoute';
import BillingGuard from '@features/billing/components/BillingGuard';
import LoadingFallback from '@components/ui/LoadingFallback';
import { ROUTES } from './routeConfig';

// Lazy load pages for code splitting
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const SessionRoutePage = lazy(() => import('@/pages/SessionRoutePage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const ForbiddenPage = lazy(() => import('@/pages/ForbiddenPage'));
const BillingPage = lazy(() => import('@/pages/BillingPage'));
const SuperadminPage = lazy(() => import('@/pages/SuperadminPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

export default function AppRoutes() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path={ROUTES.HOME} element={<LandingPage />} />
        <Route path={ROUTES.LOGIN} element={<LoginPage />} />
        <Route path={ROUTES.FORBIDDEN} element={<ForbiddenPage />} />
        <Route path={ROUTES.NOT_FOUND_PAGE} element={<NotFoundPage />} />

        <Route
          path={ROUTES.DASHBOARD}
          element={
            <ProtectedRoute role="teacher" requireActive>
              <BillingGuard>
                <DashboardPage />
              </BillingGuard>
            </ProtectedRoute>
          }
        />

        {/* Billing must stay reachable while locked — it is the only route that
            can resolve a lockout, so it never sits behind BillingGuard. */}
        <Route
          path={ROUTES.BILLING}
          element={
            <ProtectedRoute role="teacher">
              <BillingPage />
            </ProtectedRoute>
          }
        />

        {/* Superadmin console — Phase 11. Claim-gated here, rules-gated in
            Firestore, and never bundled into the teacher's chunk. */}
        <Route
          path={ROUTES.SUPERADMIN}
          element={
            <ProtectedRoute role="superadmin">
              <SuperadminPage />
            </ProtectedRoute>
          }
        />

        {/* Phase 05: sessions are documents keyed by their slug, so one dynamic
            route serves every session the teacher creates.

            This is declared AFTER every static route. React Router ranks static
            segments above dynamic ones regardless of order, but keeping the
            declaration order honest means the file reads the way it resolves.
            Reserved slugs are additionally refused at creation, so a session
            can never be created at a path it could not be reached from. */}
        <Route path="/:sessionSlug" element={<SessionRoutePage />} />

        <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
