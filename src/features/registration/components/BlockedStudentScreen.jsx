// M-PESA STK PUSH IS SWITCHED OFF FOR THE PILOT: students pay manually and
// paste the M-PESA message below. To switch it back on for the commercial
// launch, uncomment the three marked "STK" blocks in this file (and put
// `lazy, Suspense` back in the react import), then set the live Daraja keys
// in the environment. Step by step: docs/STK_PUSH_PILOT.md.
import { useState, useMemo } from 'react';
import { m } from 'framer-motion';
import { resolveBlockReason, formatKes } from '@utils/blockReason';
import { useFlag } from '@shared/config/FlagsContext';
// STK (1/3):
// import { useMpesaAvailable } from '@features/payments/hooks/useMpesaAvailable';
//
// // Lazy: only a Gold deployment with an outstanding balance ever renders this,
// // so the payment code should not be in every student's first paint.
// const PayNowPanel = lazy(() => import('@features/payments/components/PayNowPanel'));

/* eslint-disable no-unused-vars -- session, phoneNumber and onPaid are only
   used by the STK panel, which is commented out for the pilot. */
export default function BlockedStudentScreen({
  session,
  studentData,
  phoneNumber,
  onSubmitReceipt,
  onBack,
  // Called with the payment result when an M-Pesa payment succeeds.
  onPaid,
}) {
  /* eslint-enable no-unused-vars */
  const [newReceipt, setNewReceipt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const feesEnabled = useFlag('fees.enabled');
  // STK (2/3):
  // // Flag + Gold plan + credentials, decided on the server — so a Bronze or
  // // Silver deployment never offers an STK push it would refuse.
  // const mpesaAvailable = useMpesaAvailable();

  // Shared with the dashboard's blocked badge, so the teacher sees exactly
  // what the student sees.
  const blockState = useMemo(
    () => resolveBlockReason(studentData, { feesEnabled }),
    [studentData, feesEnabled]
  );

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
    <m.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card"
    >
      <div className="text-center py-4">
        {/* Blocked Icon */}
        <m.div
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
        </m.div>

        {/* Message */}
        <m.div
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
        </m.div>

        {/* Reason — DERIVED, not stored (Phase 06 D5).
            When a balance is outstanding the first line reads
            "Balance of KES 1,500 not paid", computed from the live balance at
            render. It updates itself as the student pays, and regenerates
            correctly after an unblock/re-block cycle because it was never a
            stored string that could go stale. */}
        {blockState.lines.length > 0 && (
          <div className="alert alert-danger text-start mb-4">
            <strong>
              <i className="bi bi-info-circle me-2" aria-hidden="true" />
              Reason:
            </strong>
            {blockState.lines.map((line, index) => (
              <p
                key={line}
                className={`mb-0 mt-2 ${index === 0 && blockState.balanceLine ? 'fw-bold fs-6' : ''}`}
              >
                {line}
              </p>
            ))}
          </div>
        )}

        {/* Payment summary, when there is a balance to settle. */}
        {blockState.balanceLine && (
          <div className="bg-light rounded p-3 text-start mb-4">
            <div className="d-flex justify-content-between">
              <span className="text-muted small">Amount outstanding</span>
              <strong>{formatKes(blockState.balance)}</strong>
            </div>
            <p className="small text-muted mb-0 mt-2">
              Once the full amount is paid and your teacher confirms it, your access
              returns automatically.
            </p>
          </div>
        )}

        {/* STK (3/3): Pay now — Phase 09. Sits ALONGSIDE the receipt form
            below rather than replacing it: a student without M-Pesa on this
            handset still needs the manual route.
        {mpesaAvailable && blockState.balance > 0 && (
          <Suspense fallback={null}>
            <PayNowPanel
              session={session}
              phone={phoneNumber ?? studentData.parentPhone ?? studentData.id}
              balance={blockState.balance}
              onPaid={onPaid}
            />
          </Suspense>
        )}
        */}

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
                  placeholder="Please Paste Entire M-PESA receipt message here. You may remove your account balance"
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
    </m.div>
  );
}
