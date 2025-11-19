import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export default function WelcomeBackCard({
  session,
  studentData,
  onJoinNow,
  onBack,
  loading
}) {
  const [countdown, setCountdown] = useState(3);

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
            {studentData.studentName.charAt(0).toUpperCase()}
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
