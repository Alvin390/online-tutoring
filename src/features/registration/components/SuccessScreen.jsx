import { motion } from 'framer-motion';

export default function SuccessScreen({
  title,
  message,
  zoomLink,
  showSpinner = false
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card"
    >
      <div className="text-center py-5">
        {/* Success Icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', delay: 0.2 }}
          className="mb-4"
        >
          <div
            style={{
              width: '5rem',
              height: '5rem',
              background: 'rgba(16, 185, 129, 0.1)',
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '3rem',
              color: 'var(--success-color)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            ✓
          </div>
        </motion.div>

        <h3 className="fw-bold text-success mb-3">{title}</h3>
        <p className="text-muted mb-4">{message}</p>

        {showSpinner && (
          <div className="spinner-border text-primary mb-4" role="status">
            <span className="visually-hidden">Redirecting...</span>
          </div>
        )}

        {zoomLink && (
          <a
            href={zoomLink}
            className="btn btn-primary btn-lg"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Zoom Manually
            <i className="bi bi-box-arrow-up-right ms-2" />
          </a>
        )}
      </div>
    </motion.div>
  );
}
