import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Pending approvals queue — Phase 04 Part A.
 *
 * Fed by a `collectionGroup('students')` query on `approvalStatus`, so it spans
 * every session in one listener rather than one per session. That query needs
 * BOTH the COLLECTION_GROUP-scoped index in firestore.indexes.json AND the
 * wildcard rules match — see Phase 01 D1. Missing either fails at runtime with
 * a permission error that never mentions collection groups.
 *
 * Interaction notes:
 *   - Rejection requires a reason of at least 10 characters, enforced here for
 *     immediate feedback and again in the API, which is the real control.
 *   - Bulk approve lists every name before confirming. A destructive or
 *     hard-to-reverse action that does not name what it affects is how people
 *     approve twenty students they meant to review.
 */
export default function PendingApprovalsPanel({ pending, onApprove, onReject, loading }) {
  const [rejectingPhone, setRejectingPhone] = useState(null);
  const [reason, setReason] = useState('');
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [busy, setBusy] = useState(false);

  const count = pending?.length ?? 0;
  const grouped = useMemo(() => {
    const map = new Map();
    for (const student of pending ?? []) {
      if (!map.has(student.session)) map.set(student.session, []);
      map.get(student.session).push(student);
    }
    return map;
  }, [pending]);

  const handleApprove = async (student) => {
    setBusy(true);
    await onApprove(student.session, [student.id]);
    setBusy(false);
  };

  const handleReject = async (student) => {
    if (reason.trim().length < 10) return;
    setBusy(true);
    await onReject(student.session, [student.id], reason.trim());
    setRejectingPhone(null);
    setReason('');
    setBusy(false);
  };

  const handleBulkApprove = async () => {
    setBusy(true);
    // One call per session, because the API is session-scoped — and because a
    // partial failure should not span sessions.
    for (const [session, students] of grouped.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await onApprove(session, students.map((s) => s.id));
    }
    setConfirmBulk(false);
    setBusy(false);
  };

  // Zero state. Explains what will appear here rather than rendering nothing,
  // so an empty queue reads as "working" instead of "broken".
  if (!loading && count === 0) {
    return (
      <div className="card mb-4">
        <div className="card-body text-center py-4">
          <i
            className="bi bi-inbox text-muted d-block mb-2"
            style={{ fontSize: '2rem' }}
            aria-hidden="true"
          />
          <h6 className="fw-bold mb-1">No one waiting for approval</h6>
          <p className="text-muted small mb-0">
            New students appear here after they register, and stay out of class until
            you approve them.
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card mb-4 border-warning"
    >
      <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h5 className="mb-0">
          <i className="bi bi-person-check-fill me-2" aria-hidden="true" />
          Waiting for approval
          <span className="badge text-bg-warning ms-2" aria-live="polite">
            {count}
          </span>
        </h5>

        {count > 1 && (
          <button
            className="btn btn-sm btn-outline-success"
            onClick={() => setConfirmBulk(true)}
            disabled={busy}
          >
            <i className="bi bi-check2-all me-1" aria-hidden="true" />
            Approve all ({count})
          </button>
        )}
      </div>

      {/* Bulk confirmation names every student, per the destructive-action rule. */}
      {confirmBulk && (
        <div className="card-body border-bottom bg-light">
          <p className="fw-semibold mb-2">Approve all {count} students?</p>
          <ul className="small mb-3" style={{ maxHeight: 160, overflowY: 'auto' }}>
            {pending.map((s) => (
              <li key={`${s.session}-${s.id}`}>
                {s.studentName} — {s.class} ({s.session})
              </li>
            ))}
          </ul>
          <div className="d-flex gap-2">
            <button className="btn btn-success btn-sm" onClick={handleBulkApprove} disabled={busy}>
              Yes, approve all
            </button>
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setConfirmBulk(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card-body p-0">
        <AnimatePresence initial={false}>
          {(pending ?? []).map((student) => (
            <motion.div
              key={`${student.session}-${student.id}`}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0 }}
              className="border-bottom p-3"
            >
              <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                <div className="flex-grow-1" style={{ minWidth: 220 }}>
                  <div className="fw-bold">
                    {student.studentName}
                    <span className="badge text-bg-light text-muted ms-2 text-capitalize">
                      {student.session}
                    </span>
                  </div>
                  <div className="small text-muted">
                    {student.class} · {student.subjects}
                  </div>
                  <div className="small text-muted">{student.parentPhone}</div>

                  {student.receiptMessage && (
                    <details className="mt-2">
                      <summary className="small text-primary" style={{ cursor: 'pointer' }}>
                        Payment message
                      </summary>
                      <p className="small bg-light p-2 rounded mt-1 mb-0">
                        {student.receiptMessage}
                      </p>
                    </details>
                  )}

                  {student.rejectionCount > 0 && (
                    <div className="small text-danger mt-1">
                      <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
                      Resubmitted after {student.rejectionCount} rejection
                      {student.rejectionCount > 1 ? 's' : ''}
                    </div>
                  )}
                </div>

                <div className="d-flex gap-2">
                  <button
                    className="btn btn-success btn-sm"
                    onClick={() => handleApprove(student)}
                    disabled={busy}
                  >
                    <i className="bi bi-check-lg me-1" aria-hidden="true" />
                    Approve
                  </button>
                  <button
                    className="btn btn-outline-danger btn-sm"
                    onClick={() => {
                      setRejectingPhone(student.id);
                      setReason('');
                    }}
                    disabled={busy}
                  >
                    Reject
                  </button>
                </div>
              </div>

              {rejectingPhone === student.id && (
                <div className="mt-3">
                  <label className="form-label small fw-semibold" htmlFor={`reason-${student.id}`}>
                    Why are you rejecting this registration? The student will see this.
                  </label>
                  <textarea
                    id={`reason-${student.id}`}
                    className="form-control form-control-sm"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. The payment message doesn't match the amount for Grade 8."
                    maxLength={500}
                  />
                  <div className="d-flex justify-content-between align-items-center mt-2">
                    <small className={reason.trim().length < 10 ? 'text-danger' : 'text-muted'}>
                      {reason.trim().length < 10
                        ? `${10 - reason.trim().length} more character(s) needed`
                        : `${reason.length}/500`}
                    </small>
                    <div className="d-flex gap-2">
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleReject(student)}
                        disabled={busy || reason.trim().length < 10}
                      >
                        Send rejection
                      </button>
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => setRejectingPhone(null)}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
