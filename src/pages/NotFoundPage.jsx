import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function NotFoundPage() {
  return (
    <div
      className="hero-section"
      style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
    >
      <div className="hero-overlay" />

      <div className="container position-relative">
        <div className="row min-vh-100 align-items-center justify-content-center">
          <div className="col-md-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card"
            >
              <div className="py-5">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', delay: 0.2 }}
                  className="mb-4"
                >
                  <div
                    style={{
                      width: '6rem',
                      height: '6rem',
                      background: 'rgba(239, 68, 68, 0.1)',
                      borderRadius: '50%',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '4rem',
                      color: '#dc2626',
                    }}
                  >
                    <i className="bi bi-exclamation-triangle" />
                  </div>
                </motion.div>

                <h1 className="display-1 fw-bold mb-3">404</h1>
                <h2 className="fw-bold mb-3">Page Not Found</h2>
                <p className="text-muted mb-4">
                  Sorry, the page you're looking for doesn't exist or has been moved.
                </p>

                <Link to="/" className="btn btn-primary btn-lg">
                  <i className="bi bi-house-fill me-2" />
                  Go Back Home
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
