import { Link } from 'react-router-dom';
import { m } from 'framer-motion';
import SessionCard from '@features/sessions/components/SessionCard';
import { usePublicSessions } from '@features/sessions/hooks/usePublicSessions';
import '@/styles/landing.css';
import { prefetchStaff } from '@/routes/prefetch';

export default function LandingPage() {
  const { sessions, loading } = usePublicSessions();

  return (
    <>
      {/* The hero closes BEFORE the features and footer (as in the original
          design): `.hero-section` is a flex container, and with them inside
          it they were laid out side by side and squeezed the session cards. */}
      <div className="hero-section">
        <div className="hero-background"></div>
        <div className="hero-overlay"></div>

        <div className="container position-relative">
          <div className="row min-vh-100 align-items-center justify-content-center">
            <div className="col-lg-10 text-center">
              {/* Animated Logo */}
              <m.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', duration: 0.8 }}
                className="hero-icon mb-4 animate-float"
              >
                <i className="bi bi-mortarboard-fill" />
              </m.div>

              {/* Main Heading */}
              <m.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="hero-title mb-3"
              >
                Welcome to Online Tutoring
              </m.h1>

              <m.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="hero-subtitle mb-5"
              >
                Join our interactive Zoom classes and excel in your studies
              </m.p>

              {/* Session cards — Phase 13 / 02 D5. One per ACTIVE session, in the
                  teacher's order, every detail from the session document. The
                  rest of this page (heading, subtitle, features, footer) stays
                  fixed by design. */}
              <div className="row g-4 justify-content-center" aria-live="polite" aria-busy={loading}>
                {loading
                  ? [0, 1].map((i) => (
                      <div key={i} className="col-md-6 col-lg-5">
                        <div className="session-card-skeleton" aria-hidden="true" />
                      </div>
                    ))
                  : sessions.map((session, index) => (
                      <m.div
                        key={session.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 + Math.min(index, 5) * 0.1 }}
                        className={sessions.length > 2 ? 'col-md-6 col-lg-4' : 'col-md-6 col-lg-5'}
                      >
                        <SessionCard session={session} />
                      </m.div>
                    ))}
              </div>

              {/* Teacher Portal Link */}
              <m.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="mt-5"
              >
                <Link
                  to="/dashboard"
                  className="teacher-portal-link"
                  onMouseEnter={prefetchStaff}
                  onFocus={prefetchStaff}
                  onTouchStart={prefetchStaff}
                >
                  <i className="bi bi-person-circle me-2" />
                  Teacher Dashboard
                </Link>
              </m.div>
            </div>
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
                  <i className="bi bi-shield-fill-check" />
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
    </>
  );
}
