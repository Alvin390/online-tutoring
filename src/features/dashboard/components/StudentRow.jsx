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

export default function StudentRow({ student, index, onDelete, onEdit }) {
  const [showPopup, setShowPopup] = useState(false);
  const [hoverTimeout, setHoverTimeout] = useState(null);

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
          <strong>{escapeHtml(student.studentName)}</strong>
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
        <div className="d-flex gap-1">
          <button
            className="btn btn-primary btn-sm table-action-btn"
            onClick={() => onEdit(student)}
            title="Edit student"
          >
            <i className="bi bi-pencil" />
          </button>
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
              <h6 className="student-info-name">{escapeHtml(student.studentName)}</h6>
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
                  <div className="student-info-label">Payment Receipt</div>
                  <div className="student-info-receipt">
                    <small>{escapeHtml(student.receiptMessage)}</small>
                  </div>
                </div>
              </div>

              <div className="student-info-item">
                <i className="bi bi-calendar-check student-info-icon" />
                <div className="student-info-content">
                  <div className="student-info-label">Registered</div>
                  <div className="student-info-value">{regDate}</div>
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
