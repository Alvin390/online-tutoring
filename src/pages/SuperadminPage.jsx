import { useState, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuthState, useAuthActions } from '@features/auth/context/AuthContext';

const AuditLogViewer = lazy(() => import('@features/audit/components/AuditLogViewer'));
const UserManager = lazy(() => import('@features/admin/components/UserManager'));

/**
 * Superadmin console.
 *
 * Reached only by typing /superadmin — nothing in the app links here.
 *
 * The lock is an INLINE sign-in form rather than a redirect to /login, so the
 * URL you typed is the URL you stay on, and so this page never advertises
 * itself from the ordinary login screen. Credentials are the ones created by
 * `npm run seed:superadmin` and stored in .env.local as SUPERADMIN_EMAIL /
 * SUPERADMIN_PASSWORD.
 *
 * Authentication is real Firebase Auth, so the password is scrypt-hashed by
 * Firebase, the brute-force counter from Phase 02 applies, and MFA can be
 * enabled later. The role check is a custom claim, enforced again in
 * firestore.rules and in every /api/admin handler — a signed-in teacher who
 * reaches this URL sees the refusal below and, more importantly, gets 403 from
 * the API regardless of what the UI does.
 */
export default function SuperadminPage() {
  const { isSuperadmin, isAuthenticated, loading, user } = useAuthState();
  const { signIn, signOut } = useAuthActions();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState('users');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const result = await signIn(email, password);

    if (!result.success) {
      // Same collapsed message as the main login — this page must not become
      // an oracle for which addresses exist.
      setError(result.error ?? 'Invalid email or password.');
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="container py-5 text-center">
        <span className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading…</span>
        </span>
      </div>
    );
  }

  // ---------------------------------------------------------------- locked
  if (!isAuthenticated) {
    return (
      <div
        className="hero-section"
        style={{ background: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)' }}
      >
        <div className="container position-relative">
          <div className="row min-vh-100 align-items-center justify-content-center">
            <div className="col-md-5 col-lg-4">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card"
              >
                <div className="text-center mb-4">
                  <i
                    className="bi bi-shield-lock-fill"
                    style={{ fontSize: '3rem', color: '#6b7280' }}
                    aria-hidden="true"
                  />
                  <h1 className="fw-bold h4 mt-3 mb-1">Superadmin</h1>
                  <p className="text-muted small mb-0">
                    Restricted area. Sign in with the superadmin account.
                  </p>
                </div>

                <form onSubmit={handleSubmit}>
                  <div className="mb-3">
                    <label className="form-label fw-semibold" htmlFor="sa-email">Email</label>
                    <input
                      id="sa-email"
                      type="email"
                      className="form-control form-control-lg"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="username"
                      autoFocus
                    />
                  </div>

                  <div className="mb-4">
                    <label className="form-label fw-semibold" htmlFor="sa-password">Password</label>
                    <input
                      id="sa-password"
                      type="password"
                      className="form-control form-control-lg"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                    />
                  </div>

                  {error && (
                    <div className="alert alert-danger" role="alert" aria-live="assertive">
                      {error}
                    </div>
                  )}

                  <button type="submit" className="btn btn-dark btn-lg w-100" disabled={submitting}>
                    {submitting ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" />
                        Signing in…
                      </>
                    ) : (
                      'Sign in'
                    )}
                  </button>
                </form>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------- signed in, but not the superadmin
  if (!isSuperadmin) {
    return (
      <div className="container py-5" style={{ maxWidth: 560 }}>
        <div className="alert alert-danger">
          <h1 className="h5 fw-bold mb-2">Superadmin access required</h1>
          <p className="mb-3">
            <strong>{user?.email}</strong> is signed in but does not hold the superadmin
            role. If this should be a superadmin account, run{' '}
            <code>npm run seed:superadmin</code> or grant the role from another
            superadmin session.
          </p>
          <div className="d-flex gap-2">
            <button className="btn btn-outline-danger btn-sm" onClick={signOut}>
              Sign out
            </button>
            <Link to="/dashboard" className="btn btn-outline-secondary btn-sm">
              Go to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------- unlocked
  return (
    <div className="container py-4" style={{ maxWidth: 1100 }}>
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
        <div>
          <h1 className="h3 fw-bold mb-1">
            <i className="bi bi-shield-lock-fill me-2" aria-hidden="true" />
            Superadmin
          </h1>
          <p className="text-muted mb-0 small">
            Signed in as {user?.email}
          </p>
        </div>
        <div className="d-flex gap-2">
          <Link to="/dashboard" className="btn btn-outline-secondary btn-sm">
            Dashboard
          </Link>
          <button className="btn btn-outline-dark btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      <ul className="nav nav-tabs mb-4" role="tablist">
        {[
          { id: 'users', label: 'Accounts & tiers', icon: 'bi-people' },
          { id: 'audit', label: 'Audit log', icon: 'bi-shield-check' },
        ].map((t) => (
          <li className="nav-item" key={t.id} role="presentation">
            <button
              className={`nav-link ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
              role="tab"
              aria-selected={tab === t.id}
            >
              <i className={`bi ${t.icon} me-1`} aria-hidden="true" />
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      <Suspense
        fallback={
          <div className="card">
            <div className="card-body text-center py-5">
              <span className="spinner-border spinner-border-sm text-muted" />
            </div>
          </div>
        }
      >
        {tab === 'users' ? <UserManager /> : <AuditLogViewer />}
      </Suspense>
    </div>
  );
}
