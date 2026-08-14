import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import StudentRow from './StudentRow';
import Modal from '@components/ui/Modal';
import { SkeletonTable } from '@components/ui/Skeleton';
import { postLedgerEntry } from '@services/api/fees';
import logger from '@utils/logger';

export default function StudentTable({
  session,
  students,
  onDelete,
  onEdit,
  onView,
  onExport,
  onBlock,
  onUnblock,
  onApprove,
  onDecline,
  loading
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [blockReason, setBlockReason] = useState('');
  // 'fees' posts a ledger charge and lets the student clear it by M-Pesa;
  // 'other' is the free-text block that existed before.
  const [blockKind, setBlockKind] = useState('fees');
  const [blockAmount, setBlockAmount] = useState('');
  const [blockError, setBlockError] = useState(null);

  const handleDeleteClick = (student) => {
    setSelectedStudent(student);
    setShowDeleteModal(true);
  };

  const handleEditClick = (student) => {
    setSelectedStudent(student);
    setEditForm({
      studentName: student.studentName,
      parentPhone: student.id,
      class: student.class,
      subjects: student.subjects,
      receiptMessage: student.receiptMessage
    });
    setShowEditModal(true);
  };

  const handleBlockClick = (student) => {
    setSelectedStudent(student);
    setBlockReason('');
    setBlockKind('fees');
    setBlockAmount('');
    setBlockError(null);
    setShowBlockModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedStudent) return;

    setDeleting(true);
    await onDelete(session, selectedStudent.id, selectedStudent.studentName);
    setDeleting(false);
    setShowDeleteModal(false);
    setSelectedStudent(null);
  };

  const handleEditConfirm = async () => {
    if (!selectedStudent) return;

    setSaving(true);
    await onEdit(session, editForm.parentPhone, editForm, selectedStudent.id);
    setSaving(false);
    setShowEditModal(false);
    setSelectedStudent(null);
  };

  /**
   * Two shapes of block, and the difference is not cosmetic.
   *
   * FEES: the amount the teacher types is posted to the ledger as a charge
   * BEFORE the block lands. Everything downstream is then automatic and
   * already built — the student's screen reads the balance off the ledger
   * (blockReason.js derives it, never stores it), the M-Pesa panel offers to
   * pay up to that balance, a part payment lowers the figure and leaves the
   * block in place, and a full payment auto-unblocks with the M-Pesa receipt
   * recorded against the entry.
   *
   * The charge is posted FIRST on purpose: blocking first would briefly show
   * the student "blocked, balance KES 0", which reads as a mistake.
   *
   * The reason string is left EMPTY for a fee block. blockReason.js shows the
   * derived balance line and any custom reason beneath it — putting "fees" in
   * the custom slot would just duplicate the line above it.
   *
   * OTHER: no ledger involvement at all, free text exactly as before.
   */
  const handleBlockConfirm = async () => {
    if (!selectedStudent) return;

    setBlockError(null);

    if (blockKind === 'fees') {
      const amount = Number(blockAmount);
      if (!Number.isInteger(amount) || amount < 1) {
        setBlockError('Enter the amount owed, in whole shillings.');
        return;
      }

      setBlocking(true);
      try {
        await postLedgerEntry({
          session,
          phone: selectedStudent.id,
          type: 'invoice',
          amount,
          note: 'Fees due — recorded when blocking',
        });
      } catch (error) {
        logger.error('Could not post the fee charge', error);
        // Nothing is blocked if the charge failed. Blocking anyway would leave
        // the student locked out with no balance to pay and no way back in.
        setBlockError(error?.message ?? 'Could not record that amount. Nothing was changed.');
        setBlocking(false);
        return;
      }
    } else {
      setBlocking(true);
    }

    await onBlock(
      session,
      selectedStudent.id,
      selectedStudent.studentName,
      blockKind === 'fees' ? '' : blockReason
    );

    setBlocking(false);
    setShowBlockModal(false);
    setSelectedStudent(null);
    setBlockReason('');
    setBlockAmount('');
  };

  // Skeleton rather than a spinner — Phase 10 D4. The placeholder occupies the
  // real table's height, so nothing shifts when the data arrives.
  if (loading) {
    return <SkeletonTable rows={6} columns={7} />;
  }

  if (students.length === 0) {
    return (
      <div className="alert alert-info">
        <h6 className="fw-bold mb-2">
          <i className="bi bi-info-circle me-2" />
          No students registered for {session} session yet
        </h6>
        <p className="mb-3">Share the registration link with your students to get started:</p>
        <div className="input-group">
          <input
            type="text"
            className="form-control"
            value={`${window.location.origin}/${session}`}
            readOnly
          />
          <button
            className="btn copy-link-btn"
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/${session}`);
            }}
          >
            <i className="bi bi-clipboard me-1" /> Copy
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="table-responsive">
        <table className="table table-hover align-middle mb-0">
          <thead className="table-dark">
            <tr>
              <th style={{ width: '40px' }}>#</th>
              <th>Student Name</th>
              <th>Parent Phone</th>
              <th>Class</th>
              <th>Subjects</th>
              <th style={{ width: '200px' }}>Payment Receipt</th>
              <th style={{ width: '150px' }}>Registered</th>
              <th style={{ width: '100px' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {students.map((student, index) => (
                <StudentRow
                  key={student.id}
                  student={student}
                  index={index}
                  session={session}
                  onDelete={() => handleDeleteClick(student)}
                  onEdit={() => handleEditClick(student)}
                  onView={onView ? () => onView(student) : undefined}
                  onBlock={() => handleBlockClick(student)}
                  onUnblock={onUnblock}
                  onApprove={onApprove}
                  onDecline={onDecline}
                />
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      <div className="d-flex justify-content-between align-items-center mt-3 p-3 bg-light rounded">
        <span className="text-muted">
          <i className="bi bi-people me-1" />
          Total: <strong>{students.length}</strong> student{students.length !== 1 ? 's' : ''}
        </span>
        <button
          className="btn btn-outline-primary btn-sm"
          onClick={() => onExport(session)}
        >
          <i className="bi bi-file-earmark-pdf me-1" />
          Export to PDF
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedStudent && (
        <Modal
          title="Delete Student"
          onClose={() => setShowDeleteModal(false)}
          onConfirm={handleDeleteConfirm}
          loading={deleting}
          type="danger"
        >
          <div className="text-center">
            <div className="modal-icon danger mb-3">
              <i className="bi bi-exclamation-triangle" />
            </div>
            <p className="mb-3">
              Are you sure you want to delete <strong>{selectedStudent.studentName}</strong> from {session} session?
            </p>
            <p className="text-muted mb-3">
              <small>Parent Phone: {selectedStudent.id}</small>
            </p>
            <div className="alert alert-warning text-start">
              This action cannot be undone. The student will need to register again to rejoin the class.
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Student Modal */}
      {showEditModal && selectedStudent && (
        <Modal
          title="Edit Student"
          onClose={() => setShowEditModal(false)}
          onConfirm={handleEditConfirm}
          loading={saving}
          type="primary"
        >
          <div className="mb-3">
            <label className="form-label fw-bold">
              <i className="bi bi-person me-2" />
              Student Name
            </label>
            <input
              type="text"
              className="form-control"
              value={editForm.studentName || ''}
              onChange={(e) => setEditForm({ ...editForm, studentName: e.target.value })}
            />
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold">
              <i className="bi bi-telephone me-2" />
              Parent Phone
            </label>
            <input
              type="text"
              className="form-control"
              value={editForm.parentPhone || ''}
              onChange={(e) => setEditForm({ ...editForm, parentPhone: e.target.value })}
              placeholder="+1234567890"
            />
            <small className="text-muted">Format: +[country code][number]</small>
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold">
              <i className="bi bi-book me-2" />
              Class
            </label>
            <input
              type="text"
              className="form-control"
              value={editForm.class || ''}
              onChange={(e) => setEditForm({ ...editForm, class: e.target.value })}
            />
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold">
              <i className="bi bi-journal-text me-2" />
              Subjects
            </label>
            <input
              type="text"
              className="form-control"
              value={editForm.subjects || ''}
              onChange={(e) => setEditForm({ ...editForm, subjects: e.target.value })}
              placeholder="Math, English, Science"
            />
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold">
              <i className="bi bi-receipt me-2" />
              Payment Receipt
            </label>
            <textarea
              className="form-control"
              rows="3"
              value={editForm.receiptMessage || ''}
              onChange={(e) => setEditForm({ ...editForm, receiptMessage: e.target.value })}
              placeholder="Payment details or receipt message"
            />
          </div>

          <div className="alert alert-info">
            <i className="bi bi-info-circle me-2" />
            <small>If you change the phone number, a new record will be created and the old one will be removed.</small>
          </div>
        </Modal>
      )}

      {/* Block Student Modal */}
      {showBlockModal && selectedStudent && (
        <Modal
          title="Block Student"
          onClose={() => setShowBlockModal(false)}
          onConfirm={handleBlockConfirm}
          loading={blocking}
          type="danger"
        >
          <div className="text-center">
            <div className="modal-icon danger mb-3">
              <i className="bi bi-slash-circle" />
            </div>
            <p className="mb-3">
              Block <strong>{selectedStudent.studentName}</strong> from accessing {session} session?
            </p>
            <p className="text-muted mb-3">
              <small>Parent Phone: {selectedStudent.id}</small>
            </p>

            <div className="mb-3 text-start">
              <span className="form-label fw-bold d-block" id="block-kind-label">
                <i className="bi bi-chat-left-text me-2" />
                Why?
              </span>
              <div className="btn-group w-100 mb-3" role="radiogroup" aria-labelledby="block-kind-label">
                <button
                  type="button"
                  role="radio"
                  aria-checked={blockKind === 'fees'}
                  className={`btn ${blockKind === 'fees' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setBlockKind('fees')}
                >
                  <i className="bi bi-cash-coin me-1" aria-hidden="true" />
                  Unpaid fees
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={blockKind === 'other'}
                  className={`btn ${blockKind === 'other' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setBlockKind('other')}
                >
                  <i className="bi bi-pencil me-1" aria-hidden="true" />
                  Another reason
                </button>
              </div>

              {blockKind === 'fees' ? (
                <>
                  <label className="form-label small fw-semibold" htmlFor="block-amount">
                    Amount owed (KES)
                  </label>
                  <input
                    id="block-amount"
                    type="text"
                    inputMode="numeric"
                    className={`form-control ${blockError ? 'is-invalid' : ''}`}
                    value={blockAmount}
                    onChange={(e) => setBlockAmount(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="e.g. 1500"
                    autoFocus
                  />
                  {blockError && <div className="invalid-feedback d-block">{blockError}</div>}
                  <div className="form-text">
                    Charged to their fee account. They can pay it by M-Pesa from their own
                    screen — paying in full unblocks them automatically, and a part payment
                    lowers the balance but leaves the block for you to lift.
                  </div>
                </>
              ) : (
                <>
                  <label className="form-label small fw-semibold" htmlFor="block-reason">
                    Reason <span className="text-muted fw-normal">(optional)</span>
                  </label>
                  <textarea
                    id="block-reason"
                    className="form-control"
                    rows="3"
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    placeholder="e.g., Repeated disruption in class"
                  />
                  {blockError && <div className="text-danger small mt-1">{blockError}</div>}
                </>
              )}
            </div>

            <div className="alert alert-warning text-start">
              <i className="bi bi-exclamation-triangle me-2" />
              <small>
                {blockKind === 'fees'
                  ? 'The student sees the balance owed and can clear it by M-Pesa to regain access.'
                  : 'The student will be blocked until you unblock them from this dashboard.'}
              </small>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
