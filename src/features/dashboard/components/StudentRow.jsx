import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { createPortal } from 'react-dom';

const escapeHtml = (text) => {
  if (!text) return '';
  return text
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export default function StudentRow({ student, index, session, onDelete, onEdit, onBlock, onUnblock, onApprove, onDecline }) {
  const [showPopup, setShowPopup] = useState(false);
  const [hoverTimeout, setHoverTimeout] = useState(null);

  const isBlocked = student.blocked || false;
  const hasPendingReceipt = student.receiptStatus === 'pending' && student.pendingReceipt;
  const isDeclined = student.receiptStatus === 'declined';

  const regDate = student.registeredAt?.toDate?.()
    .toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) || 'N/A';

  const handleMouseEnter = () => {
    const timeout = setTimeout(() => {
      setShowPopup(true);
    }, 1500); // 1.5 seconds delay
    setHoverTimeout(timeout);
  };

  const handleMouseLeave = () => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      setHoverTimeout(null);
    }
    setShowPopup(false);
  };

  return (
    <>
      <motion.tr
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        transition={{ delay: index * 0.05 }}
        className="student-row-wrapper"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
      <td><strong>{index + 1}</strong></td>
      <td>
        <div className="d-flex align-items-center gap-2">
          <div
            className="bg-primary bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center"
            style={{ width: '40px', height: '40px' }}
          >
            <strong className="text-primary">
              {student.studentName.charAt(0).toUpperCase()}
            </strong>
          </div>
          <div>
            <div className="d-flex align-items-center gap-2">
              <strong>{escapeHtml(student.studentName)}</strong>
              {isBlocked && <span className="badge bg-danger">Blocked</span>}
              {hasPendingReceipt && <span className="badge bg-warning">Pending Approval</span>}
            </div>
          </div>
        </div>
      </td>
      <td>
        <code className="bg-light px-2 py-1 rounded">
          {escapeHtml(student.parentPhone)}
        </code>
      </td>
      <td>
        <span className="badge bg-primary">
          {escapeHtml(student.class)}
        </span>
      </td>
      <td>
        <small className="text-muted">
          {escapeHtml(student.subjects)}
        </small>
      </td>
      <td>
        <small
          className="text-muted"
          style={{
            display: 'block',
            maxWidth: '200px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={student.receiptMessage}
        >
          {escapeHtml(student.receiptMessage)}
        </small>
      </td>
      <td>
        <small className="text-muted">{regDate}</small>
      </td>
      <td>
        <div className="d-flex gap-1 flex-wrap">
          <button
            className="btn btn-primary btn-sm table-action-btn"
            onClick={() => onEdit(student)}
            title="Edit student"
          >
            <i className="bi bi-pencil" />
          </button>
          {!isBlocked && (
            <button
              className="btn btn-warning btn-sm table-action-btn"
              onClick={onBlock}
              title="Block student"
            >
              <i className="bi bi-slash-circle" />
            </button>
          )}
          <button
            className="btn btn-danger btn-sm table-action-btn"
            onClick={onDelete}
            title="Delete student"
          >
            <i className="bi bi-trash" />
          </button>
        </div>
      </td>

      </motion.tr>

      {/* Hover Popup Portal */}
      {showPopup && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="student-info-popup"
            onMouseEnter={() => {
              if (hoverTimeout) {
                clearTimeout(hoverTimeout);
                setHoverTimeout(null);
              }
              setShowPopup(true);
            }}
            onMouseLeave={handleMouseLeave}
          >
            <div className="student-info-header">
              <div className="student-info-avatar">
                {student.studentName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-grow-1">
                <h6 className="student-info-name mb-1">{escapeHtml(student.studentName)}</h6>
                {isBlocked && (
                  <span className="badge bg-danger" style={{ fontSize: '0.7rem' }}>
                    <i className="bi bi-slash-circle me-1" />
                    BLOCKED
                  </span>
                )}
                {hasPendingReceipt && (
                  <span className="badge bg-warning text-dark ms-1" style={{ fontSize: '0.7rem' }}>
                    <i className="bi bi-clock me-1" />
                    PENDING APPROVAL
                  </span>
                )}
              </div>
            </div>

            <div className="student-info-grid">
              <div className="student-info-item">
                <i className="bi bi-telephone student-info-icon" />
                <div className="student-info-content">
                  <div className="student-info-label">Parent Phone</div>
                  <div className="student-info-value">{escapeHtml(student.parentPhone)}</div>
                </div>
              </div>

              <div className="student-info-item">
                <i className="bi bi-book student-info-icon" />
                <div className="student-info-content">
                  <div className="student-info-label">Class</div>
                  <div className="student-info-badge">{escapeHtml(student.class)}</div>
                </div>
              </div>

              <div className="student-info-item">
                <i className="bi bi-journal-text student-info-icon" />
                <div className="student-info-content">
                  <div className="student-info-label">Subjects</div>
                  <div className="student-info-value">{escapeHtml(student.subjects)}</div>
                </div>
              </div>

              <div className="student-info-item">
                <i className="bi bi-receipt student-info-icon" />
                <div className="student-info-content">
                  <div className="student-info-label">
                    Payment Receipt
                    {isBlocked && !hasPendingReceipt && (
                      <span className="badge bg-danger ms-2" style={{ fontSize: '0.65rem' }}>
                        EXPIRED
                      </span>
                    )}
                  </div>
                  <div className="student-info-receipt">
                    <small>{escapeHtml(student.receiptMessage)}</small>
                  </div>

                  {hasPendingReceipt && (
                    <div className="mt-2">
                      <div className="student-info-label text-success">
                        <i className="bi bi-clock-history me-1" />
                        New Payment Receipt (Pending)
                      </div>
                      <div className="student-info-receipt" style={{ borderLeft: '3px solid #ffc107' }}>
                        <small>{escapeHtml(student.pendingReceipt)}</small>
                      </div>
                      <div className="mt-2 d-flex gap-2">
                        <button
                          className="btn btn-success btn-sm"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await onApprove(session, student.id, student.studentName);
                            setShowPopup(false);
                          }}
                        >
                          <i className="bi bi-check-circle me-1" />
                          Approve
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await onDecline(session, student.id, student.studentName);
                            setShowPopup(false);
                          }}
                        >
                          <i className="bi bi-x-circle me-1" />
                          Decline
                        </button>
                      </div>
                    </div>
                  )}

                  {isBlocked && student.blockReason && (
                    <div className="mt-2">
                      <div className="student-info-label text-danger">
                        <i className="bi bi-info-circle me-1" />
                        Block Reason
                      </div>
                      <div className="alert alert-danger py-2 mb-0" style={{ fontSize: '0.85rem' }}>
                        {escapeHtml(student.blockReason)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="student-info-item">
                <i className="bi bi-calendar-check student-info-icon" />
                <div className="student-info-content">
                  <div className="student-info-label">Registered</div>
                  <div className="student-info-value">{regDate}</div>
                </div>
              </div>

              {isBlocked && (
                <div className="mt-3 text-center border-top pt-3">
                  <button
                    className="btn btn-outline-success btn-sm"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await onUnblock(session, student.id, student.studentName);
                      setShowPopup(false);
                    }}
                  >
                    <i className="bi bi-unlock me-1" />
                    Cancel Block
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
