import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import StudentRow from './StudentRow';
import Modal from '@components/ui/Modal';

export default function StudentTable({
  session,
  students,
  onDelete,
  onEdit,
  onExport,
  loading
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({});

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

  if (loading) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <p className="text-muted mt-3">Loading {session} students...</p>
      </div>
    );
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
                  onDelete={() => handleDeleteClick(student)}
                  onEdit={() => handleEditClick(student)}
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
    </>
  );
}
