import { m, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useState, useEffect, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { highlightMatches } from '@features/dashboard/search/highlightMatches';
import { nairobiParts, WEEKDAY_LABELS } from '@utils/dates';

/** "Sun 18:00" (Nairobi) for the scheduled-block tag — 003Fixes / 08. */
const shortWhen = (ms) => {
  const p = nairobiParts(new Date(ms));
  return `${WEEKDAY_LABELS[p.weekday]} ${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`;
};

// No escapeHtml (removed in Phase 13 / 03 D6). React escapes every text node
// already; escaping again here displayed "O'Brien" as "O&#039;Brien" and
// "Maths & Science" as "Maths &amp; Science".

/**
 * Entrance stagger cap — Phase 13 / 08 B2. Each row waited `index * 0.05 s`,
 * so on a 500-student class the last row appeared 25 seconds after mount.
 * Only the first rows are staggered now. Since 003Fixes / 02 the table
 * shows 20 rows a page, and rows do not animate at all after a page change.
 */
const STAGGER_ROWS = 10;

function StudentRow({
  student, index, session, onDelete, onEdit, onView, onBlock, onUnblock, onApprove, onDecline,
  animated = true,
  // 003Fixes / 03: the row's checkbox. onSelect is one stable callback for the
  // whole table, so ticking re-renders only the ticked row.
  selectKey, selected = false, onSelect,
  onCancelSchedule,
  // 001Fixes / 04: search terms to mark in the name, phone, class and subjects.
  terms,
  // 001Fixes / 06: shown as a badge in the all-sessions view.
  sessionName,
}) {
  const [showPopup, setShowPopup] = useState(false);
  const [hoverTimeout, setHoverTimeout] = useState(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const rowRef = useRef(null);
  const cardRef = useRef(null);
  const reduceMotion = useReducedMotion();

  const isBlocked = student.blocked || false;
  const hasPendingReceipt = student.receiptStatus === 'pending' && student.pendingReceipt;

  const regDate = student.registeredAt?.toDate?.()
    .toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) || 'N/A';

  // Detect touch device on mount
  useEffect(() => {
    const checkTouchDevice = () => {
      return ('ontouchstart' in window) ||
             (navigator.maxTouchPoints > 0) ||
             (navigator.msMaxTouchPoints > 0) ||
             !window.matchMedia('(hover: hover)').matches;
    };
    setIsTouchDevice(checkTouchDevice());
  }, []);

  const handleMouseEnter = (e) => {
    // 003Fixes / 03: arriving over the checkbox is ticking, not browsing —
    // no 1.5 s preview popping up while the teacher ticks down the list.
    if (e?.target?.closest?.('.row-select-cell')) return;
    // Only use hover on desktop
    if (!isTouchDevice) {
      const timeout = setTimeout(() => {
        setShowPopup(true);
      }, 1500);
      setHoverTimeout(timeout);
    }
  };

  const handleMouseLeave = () => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      setHoverTimeout(null);
    }
    // Only auto-close on desktop
    if (!isTouchDevice) {
      setShowPopup(false);
    }
  };

  // Escape closes the popup; a popup opened by tap takes focus (so a keyboard
  // or switch user lands inside it) and hands it back to the row on close —
  // the Phase 10 modal pattern. A desktop HOVER popup does not steal focus.
  useEffect(() => {
    if (!showPopup) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setShowPopup(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const row = rowRef.current;
    if (isTouchDevice) cardRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (isTouchDevice && row?.isConnected) row.focus?.();
    };
  }, [showPopup, isTouchDevice]);

  const handleClick = (e) => {
    // On mobile: toggle popup on click
    if (isTouchDevice) {
      // Don't trigger if clicking action buttons
      if (!e.target.closest('.table-action-btn')) {
        setShowPopup(!showPopup);
      }
    }
  };

  return (
    <>
      <m.tr
        ref={rowRef}
        tabIndex={-1}
        initial={animated ? { opacity: 0, x: -20 } : false}
        animate={{ opacity: 1, x: 0 }}
        exit={animated ? { opacity: 0, x: 20 } : undefined}
        transition={{ delay: animated && index < STAGGER_ROWS ? index * 0.05 : 0 }}
        className="student-row-wrapper"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{ cursor: 'pointer' }}
      >
      <td className="row-select-cell">
        {onSelect && (
          <input
            type="checkbox"
            className="form-check-input me-2 row-select"
            aria-label={`Select ${student.studentName ?? 'student'}`}
            title="Select this student"
            checked={selected}
            onClick={(e) => {
              e.stopPropagation();
              if (hoverTimeout) {
                clearTimeout(hoverTimeout);
                setHoverTimeout(null);
              }
            }}
            onChange={(e) => onSelect(selectKey, index, e.nativeEvent?.shiftKey === true)}
          />
        )}
        <strong>{index + 1}</strong>
      </td>
      <td>
        <div className="d-flex align-items-center gap-2">
          <div
            className="bg-primary bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center"
            style={{ width: '40px', height: '40px' }}
          >
            <strong className="text-primary">
              {student.studentName?.charAt(0)?.toUpperCase() ?? '?'}
            </strong>
          </div>
          <div>
            <div className="d-flex align-items-center gap-2">
              <strong>{highlightMatches(student.studentName, terms)}</strong>
              {sessionName && (
                <span className="badge rounded-pill text-bg-light border row-session-badge" data-testid="row-session">
                  {sessionName}
                </span>
              )}
              {isBlocked && <span className="badge bg-danger">Blocked</span>}
              {hasPendingReceipt && <span className="badge bg-warning">Pending Approval</span>}
              {student.scheduledBlock?.atMs && (
                <span className="badge rounded-pill text-bg-warning schedule-tag" data-testid="schedule-tag">
                  <i className="bi bi-clock me-1" aria-hidden="true" />
                  Block scheduled · {shortWhen(student.scheduledBlock.atMs)}
                  {onCancelSchedule && (
                    <button
                      type="button"
                      className="btn-close btn-close-sm ms-1 schedule-tag-cancel"
                      aria-label={`Cancel the scheduled block for ${student.studentName ?? 'this student'}`}
                      onClick={(e) => { e.stopPropagation(); onCancelSchedule(student); }}
                    />
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td>
        <code className="bg-light px-2 py-1 rounded">
          {highlightMatches(student.parentPhone, terms)}
        </code>
      </td>
      <td>
        <span className="badge bg-primary">
          {highlightMatches(student.class, terms)}
        </span>
      </td>
      <td>
        <small className="text-muted">
          {highlightMatches(student.subjects, terms)}
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
          {student.receiptMessage}
        </small>
      </td>
      <td>
        <small className="text-muted">{regDate}</small>
      </td>
      <td>
        <div className="d-flex gap-1 flex-wrap">
          {/* Opens the detail drawer (Phase 05) — details, and private notes
              when notes.enabled is on. */}
          {onView && (
            <button
              className="btn btn-outline-secondary btn-sm table-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                onView(student);
              }}
              title={`Open details and notes for ${student.studentName ?? 'this student'}`}
              aria-label={`Open details and notes for ${student.studentName ?? 'this student'}`}
            >
              <i className="bi bi-journal-text" aria-hidden="true" />
            </button>
          )}
          <button
            className="btn btn-primary btn-sm table-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(student);
            }}
            title="Edit student"
          >
            <i className="bi bi-pencil" />
          </button>
          {!isBlocked && (
            <button
              className="btn btn-warning btn-sm table-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                onBlock();
              }}
              title="Block student"
            >
              <i className="bi bi-slash-circle" />
            </button>
          )}
          <button
            className="btn btn-danger btn-sm table-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete student"
          >
            <i className="bi bi-trash" />
          </button>
        </div>
      </td>

      </m.tr>

      {/* Hover Popup Portal */}
      {showPopup && createPortal(
        <AnimatePresence>
          {/* Backdrop for mobile only - click to close */}
          {isTouchDevice && (
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="student-info-backdrop"
              onClick={() => setShowPopup(false)}
            />
          )}
          {/* I5 (Phase 13 / 07): POSITION and ANIMATION live on different
              elements. Framer writes an inline `transform: scale()`, which
              used to replace the stylesheet's translate(-50%) centring and
              left the card's left edge at mid-screen — off-screen on phones.
              The layer centres with grid; the card only fades and scales. */}
          <div className="student-info-layer" key="layer">
          <m.div
            ref={cardRef}
            tabIndex={-1}
            role="dialog"
            aria-label={`Details for ${student.studentName ?? 'student'}`}
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.95 }}
            transition={{ duration: reduceMotion ? 0 : 0.15, ease: 'easeOut' }}
            className="student-info-popup"
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={() => {
              if (!isTouchDevice && hoverTimeout) {
                clearTimeout(hoverTimeout);
                setHoverTimeout(null);
              }
              if (!isTouchDevice) {
                setShowPopup(true);
              }
            }}
            onMouseLeave={handleMouseLeave}
          >
            <div className="student-info-header">
              <div className="student-info-avatar">
                {student.studentName?.charAt(0)?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-grow-1">
                <h6 className="student-info-name mb-1">{student.studentName}</h6>
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
                  <div className="student-info-value">{student.parentPhone}</div>
                </div>
              </div>

              <div className="student-info-item">
                <i className="bi bi-book student-info-icon" />
                <div className="student-info-content">
                  <div className="student-info-label">Class</div>
                  <div className="student-info-badge">{student.class}</div>
                </div>
              </div>

              <div className="student-info-item">
                <i className="bi bi-journal-text student-info-icon" />
                <div className="student-info-content">
                  <div className="student-info-label">Subjects</div>
                  <div className="student-info-value">{student.subjects}</div>
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
                    <small>{student.receiptMessage}</small>
                  </div>

                  {hasPendingReceipt && (
                    <div className="mt-2">
                      <div className="student-info-label text-success">
                        <i className="bi bi-clock-history me-1" />
                        New Payment Receipt (Pending)
                      </div>
                      <div className="student-info-receipt" style={{ borderLeft: '3px solid #ffc107' }}>
                        <small>{student.pendingReceipt}</small>
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
                        {student.blockReason}
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
          </m.div>
          </div>
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

/**
 * Memoisation comparator — Phase 10 item 3.
 *
 * `StudentRow` is the largest dashboard component and was re-rendering for
 * EVERY student on any change to either session's array. One student checking
 * in re-rendered the teacher's entire table.
 *
 * Compared field by field rather than by object identity, because the Firestore
 * listener hands back a fresh object on every snapshot even when nothing this
 * row displays has changed — so a shallow `prev.student === next.student` check
 * would never hit.
 *
 * Only the fields this component actually renders are compared. Adding a field
 * to the JSX without adding it here produces a row that will not update, so the
 * list is kept adjacent to the render deliberately.
 */
const WATCHED_FIELDS = [
  'studentName',
  'parentPhone',
  'class',
  'subjects',
  'receiptMessage',
  'blocked',
  'blockReason',
  'receiptStatus',
  'pendingReceipt',
  'approvalStatus',
  'feeBalance',
  'overdue',
];

function areEqual(prev, next) {
  if (prev.session !== next.session) return false;
  if (prev.index !== next.index) return false;
  if (prev.student?.id !== next.student?.id) return false;
  // Search terms are memoised per query by the panel, so identity is enough.
  if (prev.terms !== next.terms) return false;
  if (prev.sessionName !== next.sessionName) return false;
  if (prev.selected !== next.selected || prev.onSelect !== next.onSelect) return false;
  if ((prev.student?.scheduledBlock?.atMs ?? null) !== (next.student?.scheduledBlock?.atMs ?? null)) return false;
  if (prev.onCancelSchedule !== next.onCancelSchedule) return false;

  // Callback identity: the parent passes inline arrows for onDelete/onEdit/
  // onView, so these change every render and are deliberately NOT compared —
  // comparing them would defeat the memo entirely. They only ever close over
  // `student`, which is compared below.
  for (const field of WATCHED_FIELDS) {
    if (prev.student?.[field] !== next.student?.[field]) return false;
  }

  // registeredAt is a Firestore Timestamp; compare its value, not its identity.
  const prevReg = prev.student?.registeredAt?.toMillis?.() ?? prev.student?.registeredAt ?? null;
  const nextReg = next.student?.registeredAt?.toMillis?.() ?? next.student?.registeredAt ?? null;
  if (prevReg !== nextReg) return false;

  return true;
}

export default memo(StudentRow, areEqual);
