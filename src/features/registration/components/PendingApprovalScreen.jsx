import { motion } from 'framer-motion';

/**
 * Shown to a student whose registration is awaiting the teacher's decision —
 * Phase 04 Part A.
 *
 * Deliberately warm rather than bureaucratic. From the student's side nothing
 * has gone wrong: they registered correctly and are waiting on a human. The
 * screen says what happens next and what to do if it takes too long, because
 * the single worst version of this page is one that leaves someone refreshing
 * with no idea whether they did something wrong.
 *
 * No class link is fetched on this path. The gate is enforced by
 * /api/class/link server-side; this screen is the explanation, not the control.
 */
export default function PendingApprovalScreen({ session, studentData, onBack, onRefresh, loading }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card"
    >
      <div className="py-4 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring' }}
          className="mb-4"
        >
          <div
            style={{
              width: '5rem',
              height: '5rem',
              background: 'rgba(245, 158, 11, 0.12)',
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.5rem',
              color: '#d97706',
            }}
          >
            <i className="bi bi-hourglass-split" aria-hidden="true" />
          </div>
        </motion.div>

        <h3 className="fw-bold mb-2">You&apos;re registered — just waiting on your teacher</h3>
        <p className="text-muted mb-4">
          {studentData?.studentName ? `Thanks, ${studentData.studentName}. ` : ''}
          Your teacher reviews new registrations before the first class. Once they
          approve you, come back to this page and you&apos;ll go straight in.
        </p>

        {studentData && (
          <div className="text-start bg-light p-3 rounded mb-4">
            <div className="row mb-2">
              <div className="col-5 text-muted small">Session:</div>
              <div className="col-7"><strong className="text-capitalize">{session}</strong></div>
            </div>
            <div className="row mb-2">
              <div className="col-5 text-muted small">Class:</div>
              <div className="col-7"><strong>{studentData.class}</strong></div>
            </div>
            <div className="row">
              <div className="col-5 text-muted small">Subjects:</div>
              <div className="col-7"><strong>{studentData.subjects}</strong></div>
            </div>
          </div>
        )}

        <div className="alert alert-light border d-flex gap-2 text-start" role="status">
          <i className="bi bi-info-circle text-muted mt-1" aria-hidden="true" />
          <span className="small text-muted">
            Most teachers approve within a few hours. If your class is starting soon,
            message your teacher directly — they can approve you in one tap.
          </span>
        </div>

        <button
          className="btn btn-primary btn-lg w-100 mb-3"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Checking…
            </>
          ) : (
            <>
              <i className="bi bi-arrow-clockwise me-2" aria-hidden="true" />
              Check again
            </>
          )}
        </button>

        <button className="btn btn-link" onClick={onBack}>
          <i className="bi bi-arrow-left me-1" aria-hidden="true" />
          Use a different number
        </button>
      </div>
    </motion.div>
  );
}
