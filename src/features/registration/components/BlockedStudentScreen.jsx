import { useState } from 'react';
import { motion } from 'framer-motion';

export default function BlockedStudentScreen({
  session,
  studentData,
  onSubmitReceipt,
  onBack,
  loading
}) {
  const [newReceipt, setNewReceipt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isDeclined = studentData.receiptStatus === 'declined';
  const isPending = studentData.receiptStatus === 'pending';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newReceipt.trim()) return;

    setSubmitting(true);
    await onSubmitReceipt(newReceipt);
    setSubmitting(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card"
    >
      <div className="text-center py-4">
        {/* Blocked Icon */}
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
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.5rem',
              color: 'white',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <i className="bi bi-slash-circle" />
          </div>
        </motion.div>

        {/* Message */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <h3 className="fw-bold mb-2 text-danger">
            Account Blocked
          </h3>
          <p className="text-muted mb-4">
            Hi <strong>{studentData.studentName}</strong>, your account has been temporarily blocked.
          </p>
        </motion.div>

        {/* Block Reason */}
        {studentData.blockReason && (
          <div className="alert alert-danger text-start mb-4">
            <strong>
              <i className="bi bi-info-circle me-2" />
              Reason:
            </strong>
            <p className="mb-0 mt-2">{studentData.blockReason}</p>
          </div>
        )}

        {/* Status Messages */}
        {isPending && (
          <div className="alert alert-warning text-start mb-4">
            <strong>
              <i className="bi bi-clock-history me-2" />
              Payment Receipt Under Review
            </strong>
            <p className="mb-0 mt-2">
              Your payment receipt has been submitted and is awaiting teacher approval.
              Please check back later or contact your teacher.
            </p>
          </div>
        )}

        {isDeclined && (
          <div className="alert alert-danger text-start mb-4">
            <strong>
              <i className="bi bi-x-circle me-2" />
              Payment Receipt Declined
            </strong>
            <p className="mb-0 mt-2">
              Your previous payment receipt was declined by the teacher.
              Please submit a valid payment receipt below.
            </p>
          </div>
        )}

        {!isPending && (
          <>
            {/* Instructions */}
            <div className="alert alert-info text-start mb-4">
              <h6 className="fw-bold mb-2">
                <i className="bi bi-shield-check me-2" />
                To Unblock Your Account:
              </h6>
              <ol className="mb-0 ps-3">
                <li>Make the required payment for school fees</li>
                <li>Paste your M-PESA payment receipt in the box below</li>
                <li>Submit for teacher approval</li>
                <li>Once approved, you can access the class</li>
              </ol>
            </div>

            {/* Receipt Input Form */}
            <form onSubmit={handleSubmit}>
              <div className="mb-3 text-start">
                <label className="form-label fw-bold">
                  <i className="bi bi-receipt me-2" />
                  M-PESA Payment Receipt
                </label>
                <textarea
                  className="form-control"
                  rows="6"
                  value={newReceipt}
                  onChange={(e) => setNewReceipt(e.target.value)}
                  placeholder="Paste your M-PESA payment receipt here...&#10;Example:&#10;RK49HY5WQP Confirmed.&#10;You have received Ksh2,500.00 from..."
                  required
                  disabled={submitting}
                />
                <small className="text-muted">
                  Make sure to include the complete M-PESA confirmation message
                </small>
              </div>

              <button
                type="submit"
                className="btn btn-success btn-lg w-100 mb-3"
                disabled={submitting || !newReceipt.trim()}
              >
                {submitting ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <i className="bi bi-send me-2" />
                    Submit Payment Receipt
                  </>
                )}
              </button>
            </form>
          </>
        )}

        {/* Back Button */}
        <div className="mt-3">
          <button className="btn btn-link" onClick={onBack}>
            <i className="bi bi-arrow-left me-1" />
            Use different number
          </button>
        </div>
      </div>
    </motion.div>
  );
}
