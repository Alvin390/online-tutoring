import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import LoadingFallback from '@components/ui/LoadingFallback';
import { ROUTES } from './routeConfig';

// Lazy load pages for code splitting
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const SessionRoutePage = lazy(() => import('@/pages/SessionRoutePage'));
const ForbiddenPage = lazy(() => import('@/pages/ForbiddenPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

// Staff side (Phase 13 / 08 A1): the shell carries Auth, Firestore and
// billing; the guarded pages are only reachable through it. None of this is
// in the public pages' module graph.
const StaffShell = lazy(() => import('./StaffShell'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
// One chunk per staff page (001Fixes / 04): the dashboard no longer carries
// the billing page, and billing no longer carries the dashboard.
const StaffDashboard = lazy(() => import('./staffDashboard'));
const StaffBilling = lazy(() => import('./staffBilling'));
const SuperadminPage = lazy(() => import('@/pages/SuperadminPage'));

export default function AppRoutes() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path={ROUTES.HOME} element={<LandingPage />} />
        <Route path={ROUTES.FORBIDDEN} element={<ForbiddenPage />} />
        <Route path={ROUTES.NOT_FOUND_PAGE} element={<NotFoundPage />} />

        <Route element={<StaffShell />}>
          <Route path={ROUTES.LOGIN} element={<LoginPage />} />
          <Route path={ROUTES.DASHBOARD} element={<StaffDashboard />} />

          {/* Billing must stay reachable while locked — it is the only route that
              can resolve a lockout, so it never sits behind BillingGuard. */}
          <Route path={ROUTES.BILLING} element={<StaffBilling />} />

          {/* Superadmin console.
              Deliberately NOT wrapped in ProtectedRoute: that would redirect an
              unauthenticated visitor to /login, and the requirement is an inline
              password gate on this URL. The page renders its own sign-in form and
              checks the superadmin claim itself.

              That is presentation only. The real controls are unchanged: `audit/`
              is superadmin-only in firestore.rules, and every /api/admin/* handler
              verifies the claim server-side. Nothing links here. */}
          <Route path={ROUTES.SUPERADMIN} element={<SuperadminPage />} />
        </Route>

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
