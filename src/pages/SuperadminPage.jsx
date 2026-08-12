import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { useAuthState } from '@features/auth/context/AuthContext';

// Lazy: the audit viewer is superadmin-only and must never be bundled into the
// teacher's chunk.
const AuditLogViewer = lazy(() => import('@features/audit/components/AuditLogViewer'));

/**
 * Superadmin console — Phase 11 D4.
 *
 * Gated by claim AND by rules: the route check below is UX, and `audit/` is
 * `allow read: if isSuperadmin()` regardless of what the client believes. A
 * teacher who forced this route would see the page shell and an empty,
 * permission-denied log.
 */
export default function SuperadminPage() {
  const { isSuperadmin, loading } = useAuthState();

  if (loading) {
    return (
      <div className="container py-5 text-center">
        <span className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading…</span>
        </span>
      </div>
    );
  }

  return (
    <div className="container py-4" style={{ maxWidth: 1100 }}>
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
        <div>
          <h1 className="h3 fw-bold mb-1">Superadmin</h1>
          <p className="text-muted mb-0">
            Audit trail and platform administration for this deployment.
          </p>
        </div>
        <Link to="/dashboard" className="btn btn-outline-secondary">
          <i className="bi bi-arrow-left me-2" aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>

      {!isSuperadmin ? (
        <div className="alert alert-danger" role="alert">
          <h2 className="h6 fw-bold mb-1">Superadmin access required</h2>
          <p className="mb-0">
            This account is signed in but does not hold the superadmin role.
          </p>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="card">
              <div className="card-body text-center py-5">
                <span className="spinner-border spinner-border-sm text-muted" />
              </div>
            </div>
          }
        >
          <AuditLogViewer />
        </Suspense>
      )}
    </div>
  );
}
