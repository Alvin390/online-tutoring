import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import ProtectedRoute from '@features/auth/components/ProtectedRoute';
import LoadingFallback from '@components/ui/LoadingFallback';
import { ROUTES } from './routeConfig';

// Lazy load pages for code splitting
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const MorningPage = lazy(() => import('@/pages/MorningPage'));
const EveningPage = lazy(() => import('@/pages/EveningPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const ForbiddenPage = lazy(() => import('@/pages/ForbiddenPage'));
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
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        {/* ROUTES.BILLING is added in Phase 03 alongside BillingPage. */}

        <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
