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
    updateStudent,
    exportToPDF,
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
                  onEdit={updateStudent}
                  onExport={exportToPDF}
                  loading={loading}
                />
              ) : (
                <StudentTable
                  session="evening"
                  students={eveningStudents}
                  onDelete={deleteStudent}
                  onEdit={updateStudent}
                  onExport={exportToPDF}
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
