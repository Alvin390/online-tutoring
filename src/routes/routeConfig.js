export const ROUTES = {
  HOME: '/',
  DASHBOARD: '/dashboard',
  LOGIN: '/login',
  // Phase 02
  FORBIDDEN: '/403',
  SUPERADMIN: '/superadmin',
  // Phase 03
  BILLING: '/billing',
  // Phase 05 — sessions resolve from `/:sessionSlug` against the sessions
  // collection. `/morning` and `/evening` still work because those documents
  // are keyed by exactly those slugs, so every link already handed out
  // continues to resolve.
  session: (slug) => `/${slug}`,
  MORNING: '/morning',
  EVENING: '/evening',

  NOT_FOUND_PAGE: '/404',
  NOT_FOUND: '*',
};
