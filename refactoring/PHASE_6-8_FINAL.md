# Phase 6-8: Routing, Testing & Deployment
## Final Implementation & Launch

---

## **PHASE 6: Routing, Pages & Shared Components** (Day 4, 6-8 hours)

### 6.1 Route Configuration

**File: `src/routes/routeConfig.js`**
```javascript
export const ROUTES = {
  HOME: '/',
  MORNING: '/morning',
  EVENING: '/evening',
  DASHBOARD: '/dashboard',
  LOGIN: '/login',
  NOT_FOUND: '*',
};
```

### 6.2 Protected Route Component

**File: `src/features/auth/components/ProtectedRoute.jsx`**
```javascript
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <div className="spinner-border text-primary mb-3" style={{ width: '3rem', height: '3rem' }}>
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="text-muted">Checking authentication...</p>
        </motion.div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
```

### 6.3 App Router

**File: `src/routes/AppRoutes.jsx`**
```javascript
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
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

export default function AppRoutes() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path={ROUTES.HOME} element={<LandingPage />} />
        <Route path={ROUTES.MORNING} element={<MorningPage />} />
        <Route path={ROUTES.EVENING} element={<EveningPage />} />
        <Route path={ROUTES.LOGIN} element={<LoginPage />} />
        <Route
          path={ROUTES.DASHBOARD}
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
```

### 6.4 Landing Page

**File: `src/pages/LandingPage.jsx`**
```javascript
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function LandingPage() {
  return (
    <div className="hero-section">
      <div className="hero-background"></div>
      <div className="hero-overlay"></div>

      <div className="container position-relative">
        <div className="row min-vh-100 align-items-center justify-content-center">
          <div className="col-lg-10 text-center">
            {/* Animated Logo */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', duration: 0.8 }}
              className="hero-icon mb-4 animate-float"
            >
              <i className="bi bi-mortarboard-fill" />
            </motion.div>

            {/* Main Heading */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="hero-title mb-3"
            >
              Welcome to Online Tutoring
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="hero-subtitle mb-5"
            >
              Join our interactive Zoom classes and excel in your studies
            </motion.p>

            {/* Session Cards */}
            <div className="row g-4 justify-content-center">
              {/* Morning Card */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="col-md-5"
              >
                <Link to="/morning" className="text-decoration-none">
                  <div className="session-card morning-card">
                    <div className="session-icon-wrapper">
                      <div className="session-icon morning-icon">
                        <i className="bi bi-sunrise-fill" />
                      </div>
                    </div>
                    <h3 className="session-card-title">Morning Session</h3>
                    <p className="session-card-time">
                      <i className="bi bi-clock-fill me-2" />
                      8:00 AM - 12:00 PM
                    </p>
                    <p className="session-card-description">
                      Start your day with focused learning and interactive classes
                    </p>
                    <div className="session-card-button">
                      Register Now
                      <i className="bi bi-arrow-right ms-2" />
                    </div>
                  </div>
                </Link>
              </motion.div>

              {/* Evening Card */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 }}
                className="col-md-5"
              >
                <Link to="/evening" className="text-decoration-none">
                  <div className="session-card evening-card">
                    <div className="session-icon-wrapper">
                      <div className="session-icon evening-icon">
                        <i className="bi bi-moon-stars-fill" />
                      </div>
                    </div>
                    <h3 className="session-card-title">Evening Session</h3>
                    <p className="session-card-time">
                      <i className="bi bi-clock-fill me-2" />
                      4:00 PM - 8:00 PM
                    </p>
                    <p className="session-card-description">
                      Perfect for after-school learning and homework support
                    </p>
                    <div className="session-card-button">
                      Register Now
                      <i className="bi bi-arrow-right ms-2" />
                    </div>
                  </div>
                </Link>
              </motion.div>
            </div>

            {/* Teacher Portal Link */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="mt-5"
            >
              <Link to="/dashboard" className="teacher-portal-link">
                <i className="bi bi-person-circle me-2" />
                Teacher Dashboard
              </Link>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <section className="features-section py-5">
        <div className="container">
          <div className="row g-4 text-center">
            <div className="col-md-4">
              <div className="feature-card">
                <div className="feature-icon">
                  <i className="bi bi-camera-video-fill" />
                </div>
                <h4 className="feature-title">Live Zoom Classes</h4>
                <p className="feature-description">Interactive sessions with experienced teachers</p>
              </div>
            </div>
            <div className="col-md-4">
              <div className="feature-card">
                <div className="feature-icon">
                  <i className="bi bi-phone-fill" />
                </div>
                <h4 className="feature-title">Easy Registration</h4>
                <p className="feature-description">Quick sign-up using parent's phone number</p>
              </div>
            </div>
            <div className="col-md-4">
              <div className="feature-card">
                <div className="feature-icon">
                  <i className="bi bi-shield-check-fill" />
                </div>
                <h4 className="feature-title">Secure & Verified</h4>
                <p className="feature-description">All registrations are verified by teachers</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="container text-center">
          <p className="mb-0">© 2025 Online Tutoring Platform. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
```

### 6.5 Morning/Evening Pages (Template)

**File: `src/pages/MorningPage.jsx`**
```javascript
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import CheckinCard from '@features/registration/components/CheckinCard';
import RegistrationForm from '@features/registration/components/RegistrationForm';
import WelcomeBackCard from '@features/registration/components/WelcomeBackCard';
import SuccessScreen from '@features/registration/components/SuccessScreen';
import { useRegistration } from '@features/registration/hooks/useRegistration';

const SESSION = 'morning';

export default function MorningPage() {
  const [step, setStep] = useState('checkin'); // checkin, register, welcome, success, redirect
  const [phoneNumber, setPhoneNumber] = useState('');
  const [zoomLink, setZoomLink] = useState('');

  const {
    loading,
    studentData,
    isReturningStudent,
    checkStudent,
    register,
    redirectToZoom,
  } = useRegistration(SESSION);

  const handleCheckin = async (phone) => {
    setPhoneNumber(phone);
    const { exists, data } = await checkStudent(phone);

    if (exists) {
      setStep('welcome');
    } else {
      setStep('register');
    }
  };

  const handleRegistration = async (formData) => {
    const result = await register(phoneNumber, formData);
    if (result.success) {
      setStep('success');
      handleRedirect();
    }
  };

  const handleRedirect = async () => {
    setStep('redirect');
    const result = await redirectToZoom();
    if (result.success) {
      setZoomLink(result.zoomLink);
    }
  };

  const handleBack = () => {
    setStep('checkin');
    setPhoneNumber('');
  };

  return (
    <div
      className="hero-section"
      style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
    >
      <div className="hero-overlay" />

      <div className="container position-relative">
        <div className="row min-vh-100 align-items-center justify-content-center py-5">
          <div className="col-lg-6 col-md-8">
            {/* Back Link */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 text-center"
            >
              <Link to="/" className="text-white text-decoration-none">
                <i className="bi bi-arrow-left me-2" />
                Back to Home
              </Link>
            </motion.div>

            {/* Session Badge */}
            <div className="text-center mb-4 animate-fade-in-up">
              <div className="session-badge morning-badge d-inline-flex">
                <i className="bi bi-sunrise-fill me-2" />
                Morning Session
              </div>
            </div>

            {/* Dynamic Content */}
            <AnimatePresence mode="wait">
              {step === 'checkin' && (
                <CheckinCard
                  key="checkin"
                  session={SESSION}
                  onSubmit={handleCheckin}
                  loading={loading}
                />
              )}

              {step === 'register' && (
                <RegistrationForm
                  key="register"
                  session={SESSION}
                  phoneNumber={phoneNumber}
                  onSubmit={handleRegistration}
                  onBack={handleBack}
                  loading={loading}
                />
              )}

              {step === 'welcome' && studentData && (
                <WelcomeBackCard
                  key="welcome"
                  session={SESSION}
                  studentData={studentData}
                  onJoinNow={handleRedirect}
                  onBack={handleBack}
                  loading={loading}
                />
              )}

              {(step === 'success' || step === 'redirect') && (
                <SuccessScreen
                  key="success"
                  title={step === 'success' ? 'Registration Successful! ✓' : 'Redirecting to Class... 🎓'}
                  message={
                    step === 'success'
                      ? 'Preparing to redirect to class...'
                      : "Opening Zoom meeting. If it doesn't open automatically, click the button below."
                  }
                  zoomLink={zoomLink}
                  showSpinner={true}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**File: `src/pages/EveningPage.jsx`** - Same as MorningPage but with:
- `const SESSION = 'evening';`
- `style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}`
- Evening badge icon

### 6.6 Login Page

**File: `src/pages/LoginPage.jsx`**
```javascript
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
```

### 6.7 Dashboard Page

**File: `src/pages/DashboardPage.jsx`**
```javascript
import DashboardLayout from '@features/dashboard/components/DashboardLayout';

export default function DashboardPage() {
  return <DashboardLayout />;
}
```

### 6.8 Shared UI Components

**File: `src/shared/components/ui/Modal.jsx`**
```javascript
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';

export default function Modal({
  title,
  children,
  onClose,
  onConfirm,
  loading,
  type = 'primary',
}) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="modal-overlay"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="modal-container"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h5 className="modal-title">{title}</h5>
            <button className="modal-close" onClick={onClose}>
              ×
            </button>
          </div>

          <div className="modal-body">{children}</div>

          <div className="modal-footer">
            <button
              className="btn btn-outline-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className={`btn btn-${type}`}
              onClick={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <span className="spinner-border spinner-border-sm me-2" />
              ) : null}
              Confirm
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
```

**File: `src/shared/components/ui/Toast.jsx`**
```javascript
import { motion } from 'framer-motion';
import { useEffect } from 'react';

const icons = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

export default function Toast({ id, type, title, message, duration, onClose }) {
  useEffect(() => {
    if (duration) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
      className={`toast toast-${type}`}
    >
      <div className="toast-icon">{icons[type]}</div>
      <div className="toast-content">
        <div className="toast-title">{title}</div>
        <div className="toast-message">{message}</div>
      </div>
      <button className="toast-close" onClick={onClose}>
        ×
      </button>
    </motion.div>
  );
}
```

**File: `src/shared/components/ui/LoadingFallback.jsx`**
```javascript
import { motion } from 'framer-motion';

export default function LoadingFallback() {
  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center"
      >
        <div className="spinner-border text-primary mb-3" style={{ width: '3rem', height: '3rem' }}>
          <span className="visually-hidden">Loading...</span>
        </div>
        <p className="text-muted">Loading...</p>
      </motion.div>
    </div>
  );
}
```

**File: `src/shared/components/ui/ErrorBoundary.jsx`**
```javascript
import { Component } from 'react';
import { logError } from '@utils/logger';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logError('React Error Boundary caught error', error, { errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-vh-100 d-flex align-items-center justify-content-center">
          <div className="text-center">
            <div className="mb-4">
              <i className="bi bi-exclamation-triangle-fill text-danger" style={{ fontSize: '4rem' }} />
            </div>
            <h2 className="mb-3">Something went wrong</h2>
            <p className="text-muted mb-4">
              {import.meta.env.DEV
                ? this.state.error?.message
                : 'Please refresh the page and try again.'}
            </p>
            <button
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

### 6.9 Main App Component

**File: `src/App.jsx`**
```javascript
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@features/auth/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import ErrorBoundary from '@components/ui/ErrorBoundary';
import AppRoutes from './routes/AppRoutes';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
```

### 6.10 Entry Point

**File: `src/main.jsx`**
```javascript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Import styles
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/index.css';
import './styles/animations.css';
import './styles/dashboard.css';

// Initialize Sentry in production
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**✅ Phase 6 Deliverables:**
- [ ] All pages created and functional
- [ ] Routing works correctly
- [ ] Protected routes enforce authentication
- [ ] Lazy loading implemented
- [ ] Error boundary catches errors
- [ ] Toast notifications system works
- [ ] Modal component functional
- [ ] Loading states smooth

---

## **PHASE 7: Testing** (Day 5, 4-6 hours)

### 7.1 Test Setup

**File: `vitest.config.js`**
```javascript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@features': path.resolve(__dirname, './src/features'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@services': path.resolve(__dirname, './src/services'),
      '@utils': path.resolve(__dirname, './src/shared/utils'),
      '@hooks': path.resolve(__dirname, './src/shared/hooks'),
      '@components': path.resolve(__dirname, './src/shared/components'),
    },
  },
});
```

**File: `tests/setup.js`**
```javascript
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock environment variables
vi.mock('import.meta', () => ({
  env: {
    VITE_FIREBASE_API_KEY: 'test-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'test-project',
    VITE_FIREBASE_STORAGE_BUCKET: 'test-project.appspot.com',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789',
    VITE_FIREBASE_APP_ID: '1:123456789:web:test',
    VITE_ENABLE_ANALYTICS: 'false',
    VITE_LOG_LEVEL: 'error',
    DEV: false,
    PROD: false,
  },
}));
```

### 7.2 Sample Tests

**File: `tests/unit/auth.test.js`**
```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@features/auth/context/AuthContext';

// Mock Firebase auth
vi.mock('@services/firebase/auth', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  onAuthChange: vi.fn((callback) => {
    callback(null); // No user initially
    return vi.fn(); // Unsubscribe function
  }),
}));

describe('AuthContext', () => {
  it('should provide auth context', () => {
    const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current).toHaveProperty('user');
    expect(result.current).toHaveProperty('loading');
    expect(result.current).toHaveProperty('signIn');
    expect(result.current).toHaveProperty('signOut');
  });

  it('should start with no user', () => {
    const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });
});
```

**File: `tests/unit/registration.test.js`**
```javascript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePhoneValidation } from '@features/registration/hooks/usePhoneValidation';
import { countries } from '@shared/constants/countries';

describe('usePhoneValidation', () => {
  it('should validate phone numbers correctly', () => {
    const { result } = renderHook(() => usePhoneValidation());

    // Select Kenya
    const kenya = countries.find(c => c.code === 'KE');
    act(() => {
      result.current.handleCountryChange(kenya);
    });

    expect(result.current.selectedCountry?.code).toBe('KE');

    // Enter valid Kenyan number (9 digits)
    act(() => {
      result.current.handlePhoneChange('712345678');
    });

    expect(result.current.phoneNumber).toBe('712345678');
    expect(result.current.isValid).toBe(true);

    // Get full phone number
    const fullPhone = result.current.getFullPhoneNumber();
    expect(fullPhone).toBe('+254712345678');
  });

  it('should reject invalid phone numbers', () => {
    const { result } = renderHook(() => usePhoneValidation());

    const kenya = countries.find(c => c.code === 'KE');
    act(() => {
      result.current.handleCountryChange(kenya);
    });

    // Enter invalid number (too short)
    act(() => {
      result.current.handlePhoneChange('12345');
    });

    expect(result.current.isValid).toBe(false);
  });
});
```

**✅ Phase 7 Deliverables:**
- [ ] Test setup configured
- [ ] Unit tests for auth
- [ ] Unit tests for registration
- [ ] Unit tests for dashboard
- [ ] All test scripts work (`npm run test:*`)
- [ ] Test coverage > 60%

---

## **PHASE 8: Deployment & Optimization** (Day 5, 2-3 hours)

### 8.1 Vercel Configuration

**File: `vercel.json`**
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        }
      ]
    },
    {
      "source": "/(.*)\\.(js|css|woff|woff2|ttf|otf)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

### 8.2 GitHub Actions (Optional)

**File: `.github/workflows/deploy.yml`**
```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm run test:all

      - name: Build
        run: npm run build

      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
```

### 8.3 Final README

**File: `README.md`** (Update existing)
```markdown
# Online Tutoring Platform - React Edition

Modern React application for student registration and Zoom class management.

## 🚀 Tech Stack

- **Frontend**: React 18 + Vite
- **Routing**: React Router v6
- **State**: Context API
- **Forms**: React Hook Form + Zod
- **Styling**: Bootstrap 5 + Tailwind CSS
- **Animations**: Framer Motion
- **Backend**: Firebase (Auth + Firestore + Analytics)
- **Hosting**: Vercel
- **Testing**: Vitest + React Testing Library

## 📦 Installation

```bash
# Clone repository
git clone <repo-url>
cd online-tutoring-react

# Install dependencies
npm install

# Setup environment
cp .env.example .env.local
# Add your Firebase credentials

# Run development server
npm run dev
```

## 🧪 Testing

```bash
npm run test           # Run all tests
npm run test:auth      # Test authentication
npm run test:registration  # Test registration
npm run test:dashboard     # Test dashboard
npm run test:coverage      # Coverage report
```

## 🏗️ Build & Deploy

```bash
# Build for production
npm run build

# Preview build
npm run preview

# Deploy to Vercel
vercel --prod
```

## 📱 PWA

This app is installable as a Progressive Web App. Users can add it to their home screen for native-like experience.

## 🔒 Security

- Firebase security rules enforced
- Input sanitization
- XSS protection
- HTTPS only in production

## 📄 License

Educational use only.
```

**✅ Phase 8 Deliverables:**
- [ ] Vercel config created
- [ ] Build succeeds without errors
- [ ] Bundle size optimized (<500KB)
- [ ] PWA installable
- [ ] Analytics working
- [ ] Sentry error tracking configured
- [ ] Deployed to Vercel successfully

---

## 🎉 COMPLETE REFACTOR CHECKLIST

### Infrastructure
- [ ] Vite project setup
- [ ] Dependencies installed
- [ ] Tailwind + Bootstrap configured
- [ ] Environment variables
- [ ] PWA configured

### Services & Utils
- [ ] Firebase config
- [ ] Auth service
- [ ] Firestore service
- [ ] Logger utility
- [ ] Analytics utility
- [ ] Countries constants

### Features
- [ ] Auth context & hooks
- [ ] Registration components
- [ ] Dashboard components
- [ ] All custom hooks

### Routing & Pages
- [ ] Route configuration
- [ ] Protected routes
- [ ] All pages created
- [ ] Lazy loading

### UI Components
- [ ] Toast system
- [ ] Modal component
- [ ] Error boundary
- [ ] Loading states

### Testing
- [ ] Test setup
- [ ] Unit tests
- [ ] Test scripts

### Deployment
- [ ] Vercel config
- [ ] Production build
- [ ] Live deployment

---

## 🔄 Migration Commands

```bash
# Create new React project
npm create vite@latest online-tutoring-react -- --template react
cd online-tutoring-react

# Install all dependencies
npm install react-router-dom react-hook-form zod @hookform/resolvers firebase bootstrap react-bootstrap framer-motion bootstrap-icons @sentry/react

# Install dev dependencies
npm install -D tailwindcss postcss autoprefixer vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom vite-plugin-pwa

# Initialize Tailwind
npx tailwindcss init -p

# Run development
npm run dev
```

---

## 📊 Performance Targets

- **First Contentful Paint**: < 1.5s
- **Largest Contentful Paint**: < 2.5s
- **Time to Interactive**: < 3.5s
- **Bundle Size**: < 500KB (gzipped)
- **Lighthouse Score**: > 90

---

**🎓 You now have a complete, phase-by-phase guide to transform your vanilla JS app to a modern React application with zero bugs!**
