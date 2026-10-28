import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import StudentRow from './StudentRow';
import TablePager from './TablePager';
import { PAGE_SIZE, readStoredPage, writeStoredPage } from '../search/pageStorage';
import Modal from '@components/ui/Modal';
import { SkeletonTable } from '@components/ui/Skeleton';
import { postLedgerEntry } from '@services/api/fees';
import logger from '@utils/logger';
import { useFlag } from '@shared/config/FlagsContext';
import { useAuthState } from '@features/auth/context/AuthContext';
import { TIER_RANK } from '@shared/constants/tiers';
import SubjectPicker from '@features/registration/components/SubjectPicker';
import { subjectsForClass, parseSubjects, joinSubjects } from '@shared/constants/subjects';

export default function StudentTable({
  session,
  // Phase 14: the session document — its classes and their subjects.
  sessionDoc = null,
  students,
  onDelete,
  onEdit,
  onView,
  onExport,
  onBlock,
  onUnblock,
  onApprove,
  onDecline,
  loading,
  // 001Fixes / 04: search terms to highlight, and the session's full count
  // when `students` is a filtered subset ("12 of 70").
  terms,
  totalCount,
  // 001Fixes / 06, the all-sessions view: rows from several sessions, each
  // tagged `__session` / `__key`. Every action goes to the ROW'S session.
  sessionNames = null,
  sessionDocs = null,
  showSessions = false,
  // 003Fixes / 02: what the rows are a page OF (session, search, filters,
  // sort). A new key starts again at page 1; the same key restores the page.
  pageKey = null,
}) {
  // The session a row belongs to, and a key unique across sessions (one phone
  // can be registered in two). Outside the all-sessions view these are simply
  // the open session and the phone.
  const rowSession = (student) => student?.__session ?? session;
  const rowKey = (student) => student?.__key ?? student?.id;
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [blockReason, setBlockReason] = useState('');
  /**
   * Phase 13 / 04 D5. A fee block posts a ledger charge through /api/fees/post,
   * which needs the fees feature ON and the Silver tier. It used to be the
   * default for everyone — a Bronze teacher's block failed with 403, and with
   * fees off a charge was still posted silently. Now the fee option is the
   * default only when it can actually work; otherwise it is shown disabled.
   */
  const feesFlag = useFlag('fees.enabled');
  const { tierRank, isSuperadmin } = useAuthState();
  const feesUsable = feesFlag && (isSuperadmin || (tierRank ?? 0) >= TIER_RANK.silver);
  const defaultBlockKind = feesUsable ? 'fees' : 'other';

  // 'fees' posts a ledger charge and lets the student clear it by M-Pesa;
  // 'other' is the free-text block that existed before.
  const [blockKind, setBlockKind] = useState(defaultBlockKind);

  /**
   * Pages of PAGE_SIZE rows — 003Fixes / 02, replacing the Phase 13 / 08 row
   * virtualiser. The rows are already in memory (the dashboard's listeners),
   * so a page change is a slice: no request, and only this table re-renders.
   *
   * The page is kept against `pageKey`; a different key reads as page 1
   * without an effect, so there is never a frame showing the old page. Live
   * data that shrinks the list pulls the page back to the new last page;
   * growth leaves the teacher where they are.
   */
  const tableRef = useRef(null);
  const [pageState, setPageState] = useState(() => readStoredPage(pageKey));
  const [paged, setPaged] = useState(false);
  const pageCount = Math.max(1, Math.ceil(students.length / PAGE_SIZE));
  const page = Math.min(pageState.key === pageKey ? pageState.page : 0, pageCount - 1);
  const start = page * PAGE_SIZE;
  const pageRows = useMemo(() => students.slice(start, start + PAGE_SIZE), [students, start]);

  useEffect(() => {
    writeStoredPage(pageKey, page);
  }, [pageKey, page]);

  const goToPage = useCallback((next) => {
    setPageState({ key: pageKey, page: next });
    // Rows animate in once, on arrival; paging should feel instant.
    setPaged(true);
    // Keep the teacher where they are, unless the table's top has scrolled
    // out of view above — then bring it back, under the sticky header.
    requestAnimationFrame(() => {
      const el = tableRef.current;
      if (!el) return;
      const header = document.querySelector('.dashboard-header')?.offsetHeight ?? 0;
      const top = el.getBoundingClientRect().top;
      if (top < header) window.scrollTo({ top: window.scrollY + top - header - 8 });
    });
  }, [pageKey]);
  const [blockAmount, setBlockAmount] = useState('');
  const [blockError, setBlockError] = useState(null);

  // Phase 14: the subjects offered by the class being edited.
  const editDoc = (selectedStudent && sessionDocs?.[rowSession(selectedStudent)]) ?? sessionDoc;
  const editSubjectOptions = editForm.class ? subjectsForClass(editDoc, editForm.class) : [];

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
    setBlockKind(defaultBlockKind);
    setBlockAmount('');
    setBlockError(null);
    setShowBlockModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedStudent) return;

    setDeleting(true);
    await onDelete(rowSession(selectedStudent), selectedStudent.id, selectedStudent.studentName);
    setDeleting(false);
    setShowDeleteModal(false);
    setSelectedStudent(null);
  };

  const handleEditConfirm = async () => {
    if (!selectedStudent) return;

    setSaving(true);
    const result = await onEdit(rowSession(selectedStudent), editForm.parentPhone, editForm, selectedStudent.id);
    setSaving(false);
    // Keep the form open on failure, so the teacher's typing is not lost.
    if (result?.success === false) return;
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

    if (blockKind === 'fees' && feesUsable) {
      const amount = Number(blockAmount);
      if (!Number.isInteger(amount) || amount < 1) {
        setBlockError('Enter the amount owed, in whole shillings.');
        return;
      }

      setBlocking(true);
      try {
        await postLedgerEntry({
          session: rowSession(selectedStudent),
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
      rowSession(selectedStudent),
      selectedStudent.id,
      selectedStudent.studentName,
      blockKind === 'fees' && feesUsable ? '' : blockReason
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
      <div className="table-responsive" ref={tableRef}>
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
            {/* Keyed by page: a page change remounts the group, so the old
                page's rows leave at once instead of playing their exit
                animation beside the new page (seen in Chromium, 003Fixes/02).
                Within a page, a row removed live still animates out. */}
            <AnimatePresence key={page} initial={!paged}>
              {pageRows.map((student, i) => (
                <StudentRow
                  key={rowKey(student)}
                  student={student}
                  index={start + i}
                  session={rowSession(student)}
                  sessionName={showSessions ? (sessionNames?.[rowSession(student)] ?? rowSession(student)) : undefined}
                  animated={!paged}
                  onDelete={() => handleDeleteClick(student)}
                  onEdit={() => handleEditClick(student)}
                  onView={onView ? () => onView(student) : undefined}
                  onBlock={() => handleBlockClick(student)}
                  onUnblock={onUnblock}
                  onApprove={onApprove}
                  onDecline={onDecline}
                  terms={terms}
                />
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {pageCount > 1 && <TablePager page={page} pageCount={pageCount} onPage={goToPage} />}

      <div className="d-flex justify-content-between align-items-center mt-3 p-3 bg-light rounded">
        <span className="text-muted" data-testid="table-total">
          <i className="bi bi-people me-1" />
          {pageCount > 1 ? (
            <>
              Showing <strong>{start + 1}–{start + pageRows.length}</strong> of {students.length}
              {totalCount != null && totalCount !== students.length ? ` (${totalCount} in total)` : ''} students
            </>
          ) : totalCount != null && totalCount !== students.length ? (
            <>Showing <strong>{students.length}</strong> of {totalCount} students</>
          ) : (
            <>Total: <strong>{students.length}</strong> student{students.length !== 1 ? 's' : ''}</>
          )}
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
              Are you sure you want to delete <strong>{selectedStudent.studentName}</strong>?
            </p>
            <p className="text-muted mb-3">
              <small>Parent Phone: {selectedStudent.id}</small>
            </p>
            <div className="alert alert-warning text-start">
              This cannot be undone. Their <strong>private notes are deleted too</strong>, and they will
              need to register again to rejoin. Their fee history is kept for your records.
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
              type="tel"
              inputMode="tel"
              className="form-control"
              value={editForm.parentPhone || ''}
              onChange={(e) => setEditForm({ ...editForm, parentPhone: e.target.value })}
              placeholder="+254712345678"
            />
            <small className="text-muted">
              International format without the leading 0, e.g. +254712345678. Changing it moves the
              student&apos;s notes and fee history to the new number.
            </small>
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
            <label className="form-label fw-bold" id="edit-subjects-label">
              <i className="bi bi-journal-text me-2" />
              Subjects
            </label>
            {/* Phase 14: the student's class's subjects as checkboxes. Any
                subject they already have that is not on the list stays ticked
                (shown as "not on this class's list"); a class without a list
                keeps the text box. */}
            {editSubjectOptions.length > 0 ? (
              <SubjectPicker
                options={editSubjectOptions}
                value={parseSubjects(editForm.subjects || '')}
                onChange={(names) => setEditForm({ ...editForm, subjects: joinSubjects(names) })}
                lockCompulsory={false}
                describedBy="edit-subjects-label"
                legend={`Subjects for ${editForm.class}`}
              />
            ) : (
              <input
                type="text"
                className="form-control"
                value={editForm.subjects || ''}
                onChange={(e) => setEditForm({ ...editForm, subjects: e.target.value })}
                placeholder="Math, English, Science"
                aria-labelledby="edit-subjects-label"
              />
            )}
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
              Block <strong>{selectedStudent.studentName}</strong> from accessing{' '}
              {sessionNames?.[rowSession(selectedStudent)] ?? `${rowSession(selectedStudent)} session`}?
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
                  aria-describedby={feesUsable ? undefined : 'block-fees-unavailable'}
                  className={`btn ${blockKind === 'fees' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setBlockKind('fees')}
                  disabled={!feesUsable}
                >
                  <i className="bi bi-cash-coin me-1" aria-hidden="true" />
                  Unpaid fees
                  {!feesUsable && <i className="bi bi-lock-fill ms-1" aria-hidden="true" />}
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

              {!feesUsable && (
                <div id="block-fees-unavailable" className="form-text mb-2">
                  {feesFlag
                    ? 'Blocking for unpaid fees records the amount owed, which needs the Silver plan.'
                    : 'Turn on fee tracking to block for unpaid fees and let students pay by M-Pesa.'}
                </div>
              )}

              {blockKind === 'fees' && feesUsable ? (
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
                {blockKind === 'fees' && feesUsable
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
