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
