import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

/**
 * 403 — Phase 02 D5.
 *
 * Shown when a signed-in user reaches a route their role does not cover.
 * Deliberately a page rather than a redirect: sending a wrong-role user to the
 * login page they are already signed in to produces a loop, which reads as a
 * broken app rather than a refusal.
 */
export default function ForbiddenPage() {
  return (
    <div
      className="hero-section"
      style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
    >
      <div className="hero-overlay" />

      <div className="container position-relative">
        <div className="row min-vh-100 align-items-center justify-content-center">
          <div className="col-md-6 col-lg-5">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card text-center"
            >
              <i
                className="bi bi-shield-lock-fill mb-3"
                style={{ fontSize: '3.5rem', color: '#764ba2' }}
                aria-hidden="true"
              />
              <h1 className="fw-bold h3">You don&apos;t have access to this page</h1>
              <p className="text-muted mb-4">
                Your account is signed in, but it isn&apos;t permitted to view this area.
                If you think that&apos;s wrong, ask whoever set up your account to check
                your role.
              </p>

              <div className="d-flex gap-2 justify-content-center flex-wrap">
                <Link to="/dashboard" className="btn btn-primary">
                  <i className="bi bi-speedometer2 me-2" aria-hidden="true" />
                  Go to dashboard
                </Link>
                <Link to="/" className="btn btn-outline-secondary">
                  <i className="bi bi-house me-2" aria-hidden="true" />
                  Back to home
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
