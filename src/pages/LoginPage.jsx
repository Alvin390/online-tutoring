import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@features/auth/context/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn(email, password);

    if (result.success) {
      navigate('/dashboard');
    } else {
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

                {/* Error */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="alert alert-danger"
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
