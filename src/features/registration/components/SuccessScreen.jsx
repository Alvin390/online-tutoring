import { motion } from 'framer-motion';
import { providerLabel } from '@utils/classLink';

/**
 * Redirect screen — Phase 04 Part B.
 *
 * Now provider-aware. The copy used to be hardcoded to Zoom
 * ("Opening Zoom meeting…", "Open Zoom Manually"), which reads as a bug to a
 * teacher who pasted a Google Meet link.
 *
 * The countdown replaces the old silent 2-second `setTimeout`: the student can
 * see what is happening and can skip it. Cleanup lives in `useRegistration`,
 * where the timer is owned.
 */
export default function SuccessScreen({
  title,
  message,
  zoomLink,
  provider,
  countdown,
  onJoinNow,
  showSpinner = false,
}) {
  const label = providerLabel(provider);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card"
    >
      <div className="text-center py-5">
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

        {/* Visible countdown rather than an unexplained pause. */}
        {typeof countdown === 'number' && countdown > 0 && (
          <p className="fw-semibold mb-3" aria-live="polite">
            Opening {label} in {countdown}…
          </p>
        )}

        {showSpinner && countdown === undefined && (
          <div className="spinner-border text-primary mb-4" role="status">
            <span className="visually-hidden">Redirecting…</span>
          </div>
        )}

        {zoomLink && (
          <div className="d-grid gap-2">
            {onJoinNow && (
              <button className="btn btn-primary btn-lg" onClick={onJoinNow}>
                Join now
                <i className="bi bi-box-arrow-in-right ms-2" aria-hidden="true" />
              </button>
            )}
            <a
              href={zoomLink}
              className={onJoinNow ? 'btn btn-outline-primary' : 'btn btn-primary btn-lg'}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open {label} manually
              <i className="bi bi-box-arrow-up-right ms-2" aria-hidden="true" />
            </a>
          </div>
        )}
      </div>
    </motion.div>
  );
}
