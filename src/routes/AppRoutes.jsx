import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import ProtectedRoute from '@features/auth/components/ProtectedRoute';
import BillingGuard from '@features/billing/components/BillingGuard';
import LoadingFallback from '@components/ui/LoadingFallback';
import { ROUTES } from './routeConfig';

// Lazy load pages for code splitting
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const MorningPage = lazy(() => import('@/pages/MorningPage'));
const EveningPage = lazy(() => import('@/pages/EveningPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const ForbiddenPage = lazy(() => import('@/pages/ForbiddenPage'));
const BillingPage = lazy(() => import('@/pages/BillingPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

export default function AppRoutes() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path={ROUTES.HOME} element={<LandingPage />} />
        <Route path={ROUTES.MORNING} element={<MorningPage />} />
        <Route path={ROUTES.EVENING} element={<EveningPage />} />
        <Route path={ROUTES.LOGIN} element={<LoginPage />} />
        <Route path={ROUTES.FORBIDDEN} element={<ForbiddenPage />} />

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

        <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
