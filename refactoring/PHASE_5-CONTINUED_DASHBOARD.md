# Phase 5 Continued: Dashboard Components
## Complete Dashboard Feature Implementation

---

### 5.3 Stats Cards Component

**File: `src/features/dashboard/components/StatsCards.jsx`**
```javascript
import { motion } from 'framer-motion';

export default function StatsCards({
  morningCount,
  eveningCount,
  totalCount,
  linksConfigured
}) {
  const stats = [
    {
      title: 'Morning Students',
      value: morningCount,
      icon: 'sunrise-fill',
      color: 'primary',
      gradient: 'morning-gradient',
    },
    {
      title: 'Evening Students',
      value: eveningCount,
      icon: 'moon-stars-fill',
      color: 'danger',
      gradient: 'evening-gradient',
    },
    {
      title: 'Total Students',
      value: totalCount,
      icon: 'people-fill',
      color: 'success',
      gradient: 'success-gradient',
    },
    {
      title: 'Zoom Links',
      value: `${linksConfigured}/2`,
      icon: 'link-45deg',
      color: 'warning',
      gradient: null,
    },
  ];

  return (
    <div className="row g-4 mb-4">
      {stats.map((stat, index) => (
        <div key={stat.title} className="col-md-6 col-lg-3">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className={`stat-card ${stat.gradient ? stat.gradient : ''}`}
            style={{
              borderLeft: `4px solid var(--${stat.color}-color)`,
            }}
          >
            <div className="d-flex justify-content-between align-items-start mb-3">
              <div>
                <p className="text-muted mb-1 small">{stat.title}</p>
                <h2 className="stat-value mb-0">{stat.value}</h2>
              </div>
              <div className={`bg-${stat.color} bg-opacity-10 p-3 rounded`}>
                <i className={`bi bi-${stat.icon} text-${stat.color} fs-4`} />
              </div>
            </div>
            <small className="text-success">
              <i className="bi bi-arrow-up me-1" />
              Active registrations
            </small>
          </motion.div>
        </div>
      ))}
    </div>
  );
}
```

### 5.4 Student Table Component

**File: `src/features/dashboard/components/StudentTable.jsx`**
```javascript
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import StudentRow from './StudentRow';
import Modal from '@components/ui/Modal';

export default function StudentTable({
  session,
  students,
  onDelete,
  onExport,
  loading
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteClick = (student) => {
    setSelectedStudent(student);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedStudent) return;

    setDeleting(true);
    await onDelete(session, selectedStudent.id, selectedStudent.studentName);
    setDeleting(false);
    setShowDeleteModal(false);
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
          <i className="bi bi-download me-1" />
          Export to CSV
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
    </>
  );
}
```

### 5.5 Student Row Component

**File: `src/features/dashboard/components/StudentRow.jsx`**
```javascript
import { motion } from 'framer-motion';

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

export default function StudentRow({ student, index, onDelete }) {
  const regDate = student.registeredAt?.toDate?.()
    .toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) || 'N/A';

  return (
    <motion.tr
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ delay: index * 0.05 }}
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
        <button
          className="btn btn-danger btn-sm table-action-btn"
          onClick={onDelete}
        >
          <i className="bi bi-trash" />
        </button>
      </td>
    </motion.tr>
  );
}
```

### 5.6 Dashboard Layout Component

**File: `src/features/dashboard/components/DashboardLayout.jsx`**
```javascript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@features/auth/context/AuthContext';
import StatsCards from './StatsCards';
import ZoomLinkManager from './ZoomLinkManager';
import StudentTable from './StudentTable';
import { useDashboard } from '../hooks/useDashboard';

export default function DashboardLayout() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const {
    morningStudents,
    eveningStudents,
    zoomLinks,
    loading,
    activeTab,
    setActiveTab,
    updateZoomLink,
    deleteStudent,
    exportToCSV,
    totalStudents,
  } = useDashboard();

  const [refreshing, setRefreshing] = useState(false);

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  const handleRefresh = () => {
    setRefreshing(true);
    // Firestore listeners will auto-update
    setTimeout(() => setRefreshing(false), 1000);
  };

  const linksConfigured = (zoomLinks.morning ? 1 : 0) + (zoomLinks.evening ? 1 : 0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="dashboard-container"
    >
      {/* Dashboard Header */}
      <div className="dashboard-header text-white py-3 sticky-top">
        <div className="container-fluid">
          <div className="d-flex justify-content-between align-items-center">
            <div className="d-flex align-items-center gap-3">
              <i className="bi bi-speedometer2 fs-3" />
              <div>
                <h4 className="mb-0 fw-bold">Teacher Dashboard</h4>
                <small className="opacity-75">Student Registration Management</small>
              </div>
            </div>
            <div className="d-flex align-items-center gap-3">
              <button
                className="btn btn-light btn-sm"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <i className={`bi bi-arrow-clockwise ${refreshing ? 'spin' : ''}`} />
              </button>
              <div className="text-end d-none d-md-block">
                <small className="d-block opacity-75">Logged in as</small>
                <span className="fw-semibold">{user?.email}</span>
              </div>
              <button className="btn btn-light" onClick={handleLogout}>
                <i className="bi bi-box-arrow-right me-1" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="container-fluid py-4">
        {/* Stats Cards */}
        <StatsCards
          morningCount={morningStudents.length}
          eveningCount={eveningStudents.length}
          totalCount={totalStudents}
          linksConfigured={linksConfigured}
        />

        {/* Zoom Link Management */}
        <ZoomLinkManager
          zoomLinks={zoomLinks}
          onUpdate={updateZoomLink}
          loading={loading}
        />

        {/* Students Management */}
        <div className="card animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <div className="card-header bg-white border-0">
            <ul className="nav nav-tabs card-header-tabs mb-0">
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'morning' ? 'active' : ''}`}
                  onClick={() => setActiveTab('morning')}
                >
                  <i className="bi bi-sunrise-fill me-2" />
                  Morning Session (<span className="fw-bold">{morningStudents.length}</span>)
                </button>
              </li>
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'evening' ? 'active' : ''}`}
                  onClick={() => setActiveTab('evening')}
                >
                  <i className="bi bi-moon-stars-fill me-2" />
                  Evening Session (<span className="fw-bold">{eveningStudents.length}</span>)
                </button>
              </li>
            </ul>
          </div>

          <div className="card-body p-0">
            <div className="tab-content p-4">
              {activeTab === 'morning' ? (
                <StudentTable
                  session="morning"
                  students={morningStudents}
                  onDelete={deleteStudent}
                  onExport={exportToCSV}
                  loading={loading}
                />
              ) : (
                <StudentTable
                  session="evening"
                  students={eveningStudents}
                  onDelete={deleteStudent}
                  onExport={exportToCSV}
                  loading={loading}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
```

**✅ Phase 5 Deliverables:**
- [ ] All dashboard components created
- [ ] Stats cards display correctly
- [ ] Zoom link manager functional
- [ ] Student table renders with data
- [ ] Delete student with confirmation modal
- [ ] CSV export works
- [ ] Real-time listeners update UI
- [ ] Refresh button works
- [ ] Tab switching smooth

---

### 5.7 Additional Dashboard CSS

**File: Add to `src/styles/dashboard.css`**
```css
/* Dashboard specific styles */
.dashboard-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  z-index: 1000;
}

.stat-card {
  background: white;
  border-radius: 1rem;
  padding: 1.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}

.stat-value {
  font-size: 2.5rem;
  font-weight: 800;
  background: var(--primary-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.link-input-group {
  background: rgba(102, 126, 234, 0.05);
  border-radius: 1rem;
  padding: 1.5rem;
  border: 2px dashed rgba(102, 126, 234, 0.2);
  transition: all 0.3s ease;
}

.link-input-group:hover {
  border-color: var(--primary-color);
  background: rgba(102, 126, 234, 0.08);
}

.nav-tabs .nav-link {
  border: none;
  border-radius: 0;
  color: var(--text-secondary);
  font-weight: 600;
  padding: 1rem 2rem;
  transition: all 0.3s ease;
}

.nav-tabs .nav-link:hover {
  color: var(--primary-color);
  background: rgba(102, 126, 234, 0.05);
}

.nav-tabs .nav-link.active {
  color: var(--primary-color);
  background: rgba(102, 126, 234, 0.1);
  border-bottom: 3px solid var(--primary-color);
}

.table-action-btn {
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  border-radius: 0.5rem;
}

.copy-link-btn {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.2);
  color: var(--info-color);
  transition: all 0.3s ease;
}

.copy-link-btn:hover {
  background: var(--info-color);
  color: white;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
```

---

## Component File Checklist

**Registration Feature:**
- [x] CheckinCard.jsx
- [x] RegistrationForm.jsx
- [x] WelcomeBackCard.jsx
- [x] CountrySelector.jsx
- [x] PhoneInput.jsx
- [x] CountdownTimer.jsx (embedded in WelcomeBack)
- [x] SuccessScreen.jsx
- [x] useRegistration.js
- [x] usePhoneValidation.js
- [x] registrationSchema.js

**Dashboard Feature:**
- [x] DashboardLayout.jsx
- [x] StatsCards.jsx
- [x] ZoomLinkManager.jsx
- [x] StudentTable.jsx
- [x] StudentRow.jsx
- [x] useDashboard.js

**Auth Feature:**
- [x] LoginForm.jsx (to be created in next phase)
- [x] ProtectedRoute.jsx (to be created in next phase)
- [x] AuthContext.jsx (completed in Phase 3)
- [x] useAuth.js (exported from AuthContext)

---

## Next Steps: Phase 6-8

1. **Phase 6**: Create pages, routing, and UI components
2. **Phase 7**: Testing setup and implementation
3. **Phase 8**: Deployment and optimization

Ready to continue with Phase 6?
