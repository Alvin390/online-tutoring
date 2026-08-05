import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuthActions } from '@features/auth/context/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Only the actions context, so a claim refresh elsewhere does not re-render
  // this form and drop what the user is typing.
  const { signIn } = useAuthActions();
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * Deep-link preservation — Phase 02 D5. ProtectedRoute stashes the intended
   * destination in location.state; an internal path only, so a crafted
   * `?next=https://evil.com` cannot turn the login page into an open redirect.
   */
  const rawFrom = location.state?.from;
  const redirectTo =
    typeof rawFrom === 'string' && rawFrom.startsWith('/') && !rawFrom.startsWith('//')
      ? rawFrom
      : '/dashboard';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn(email, password);

    if (result.success) {
      navigate(redirectTo, { replace: true });
    } else {
      // getAuthErrorMessage already collapses auth/user-not-found and
      // auth/wrong-password into one message, so a failed sign-in never
      // reveals whether the address is registered.
      setError(result.error);
      setLoading(false);
    }
  };

  return (
    <div
      className="hero-section"
      style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
    >
      <div className="hero-overlay" />

      <div className="container position-relative">
        <div className="row min-vh-100 align-items-center justify-content-center">
          <div className="col-md-5 col-lg-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card"
            >
              <div className="text-center mb-4">
                <div className="mb-3">
                  <i
                    className="bi bi-mortarboard-fill"
                    style={{
                      fontSize: '4rem',
                      background: 'var(--primary-gradient)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                    }}
                  />
                </div>
                <h2 className="fw-bold">Teacher Dashboard</h2>
                <p className="text-muted">Sign in to manage student registrations</p>
              </div>

              <form onSubmit={handleSubmit}>
                {/* Email */}
                <div className="mb-3">
                  <label className="form-label fw-semibold">Email Address</label>
                  <input
                    type="email"
                    className="form-control form-control-lg"
                    placeholder="teacher@school.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="username"
                    autoFocus
                  />
                </div>

                {/* Password */}
                <div className="mb-4">
                  <label className="form-label fw-semibold">Password</label>
                  <div className="input-group input-group-lg">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="form-control"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                    />
                    <button
                      className="btn btn-outline-secondary"
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      <i className={`bi bi-eye${showPassword ? '-slash' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Error. role="alert" so a screen reader announces the
                    failure rather than leaving the user waiting silently. */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="alert alert-danger"
                    role="alert"
                    aria-live="assertive"
                  >
                    {error}
                  </motion.div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  className="btn btn-primary btn-lg w-100 mb-3"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-box-arrow-in-right me-2" />
                      Sign In
                    </>
                  )}
                </button>

                {/* Back to Home */}
                <div className="text-center">
                  <Link to="/" className="text-muted text-decoration-none">
                    <i className="bi bi-arrow-left me-1" />
                    Back to Home
                  </Link>
                </div>
              </form>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
