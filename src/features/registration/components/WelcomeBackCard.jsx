import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { formatKes } from '@utils/blockReason';
import { useFlag } from '@shared/config/FlagsContext';

export default function WelcomeBackCard({
  session,
  studentData,
  onJoinNow,
  onBack,
  loading
}) {
  const [countdown, setCountdown] = useState(3);
  const feesEnabled = useFlag('fees.enabled');

  const balance = Number(studentData?.feeBalance) || 0;

  const feeState = useMemo(() => {
    if (balance > 0) {
      return {
        alertClass: 'alert-warning',
        icon: 'bi-exclamation-circle-fill',
        label: 'Fees outstanding',
      };
    }
    if (balance < 0) {
      return { alertClass: 'alert-info', icon: 'bi-wallet2', label: 'Account in credit' };
    }
    return { alertClass: 'alert-success', icon: 'bi-check-circle-fill', label: 'Fees fully paid' };
  }, [balance]);

  useEffect(() => {
    if (countdown <= 0) {
      onJoinNow();
      return;
    }

    const timer = setTimeout(() => {
      setCountdown(countdown - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, onJoinNow]);

  const regDate = studentData.registeredAt?.toDate?.()
    .toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }) || 'Recently';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card"
    >
      <div className="py-4 text-center">
        {/* Profile Icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring' }}
          className="mb-4"
        >
          <div
            style={{
              width: '5rem',
              height: '5rem',
              background: `var(--${session}-gradient)`,
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.5rem',
              color: 'white',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {/* Guarded: a legacy record with no studentName threw here and took
                the whole screen down with it. */}
            {studentData.studentName?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
        </motion.div>

        {/* Welcome Message */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <h3 className="fw-bold mb-2">
            Welcome Back, {studentData.studentName}! 👋
          </h3>
          <p className="text-muted mb-4">
            We found your registration for <strong>{session} session</strong>
          </p>
        </motion.div>

        {/* Student Details */}
        <div className="text-start bg-light p-3 rounded mb-4">
          <div className="row mb-2">
            <div className="col-5 text-muted small">Class:</div>
            <div className="col-7"><strong>{studentData.class}</strong></div>
          </div>
          <div className="row mb-2">
            <div className="col-5 text-muted small">Subjects:</div>
            <div className="col-7"><strong>{studentData.subjects}</strong></div>
          </div>
          <div className="row">
            <div className="col-5 text-muted small">Registered:</div>
            <div className="col-7"><strong>{regDate}</strong></div>
          </div>
        </div>

        {/* Fee summary — Phase 06 D9.
            Colour is never the only carrier of meaning: each state has an icon
            and a text label as well, so it reads correctly for colourblind
            users and in a screenshot printed in greyscale. */}
        {feesEnabled && feeState && (
          <div className={`alert ${feeState.alertClass} text-start mb-4`} role="status">
            <div className="d-flex justify-content-between align-items-center">
              <span className="fw-semibold">
                <i className={`bi ${feeState.icon} me-2`} aria-hidden="true" />
                {feeState.label}
              </span>
              <strong>{formatKes(Math.abs(balance))}</strong>
            </div>
          </div>
        )}

        {/* Countdown */}
        <motion.div
          key={countdown}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
          className="alert alert-info mb-4"
        >
          <i className="bi bi-info-circle me-2" />
          Redirecting you to class in <strong>{countdown}</strong> seconds...
        </motion.div>

        {/* Loading Spinner */}
        <div className="spinner-border text-primary mb-4" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>

        {/* Manual Join Button */}
        <button
          className="btn btn-primary btn-lg w-100 mb-3"
          onClick={onJoinNow}
          disabled={loading}
        >
          Join Class Now
          <i className="bi bi-box-arrow-in-right ms-2" />
        </button>

        {/* Back Button */}
        <div className="mt-3">
          <button className="btn btn-link" onClick={onBack}>
            <i className="bi bi-arrow-left me-1" />
            Not you? Use different number
          </button>
        </div>
      </div>
    </motion.div>
  );
}
