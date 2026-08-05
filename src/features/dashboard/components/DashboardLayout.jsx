import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuthState, useAuthActions } from '@features/auth/context/AuthContext';
import IdleWarningModal from '@features/auth/components/IdleWarningModal';
import useIdleTimeout from '@hooks/useIdleTimeout';
import StatsCards from './StatsCards';
import ClassLinkManager from './ClassLinkManager';
import PendingApprovalsPanel from './PendingApprovalsPanel';
import StudentTable from './StudentTable';
import { useDashboard } from '../hooks/useDashboard';
import { useFlag } from '@shared/config/FlagsContext';

export default function DashboardLayout() {
  const navigate = useNavigate();
  const { user } = useAuthState();
  const { signOut } = useAuthActions();
  const {
    morningStudents,
    eveningStudents,
    pendingApprovals,
    zoomLinks,
    loading,
    activeTab,
    setActiveTab,
    updateZoomLink,
    deleteStudent,
    updateStudent,
    exportToPDF,
    blockStudent,
    unblockStudent,
    approveReceipt,
    declineReceipt,
    approveStudents,
    rejectStudents,
    totalStudents,
  } = useDashboard();

  const requireApproval = useFlag('registration.requireApproval');

  const [refreshing, setRefreshing] = useState(false);

  const handleLogout = useCallback(async () => {
    await signOut();
    navigate('/');
  }, [signOut, navigate]);

  /**
   * Idle timeout — Phase 02 D3. The dashboard shows every student's name,
   * parent phone and payment history, so an unattended session is a real
   * exposure rather than a hygiene nit. 12 hours, warning at 11h58m.
   */
  const { warning, msRemaining, reset } = useIdleTimeout({
    timeoutMs: 12 * 60 * 60 * 1000,
    warningMs: 2 * 60 * 1000,
    onTimeout: handleLogout,
  });

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
      <IdleWarningModal
        open={warning}
        msRemaining={msRemaining}
        onStaySignedIn={reset}
        onSignOut={handleLogout}
      />

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

        {/* Pending approvals sit above everything else: a student waiting to be
            let into a class that is already running is the most time-sensitive
            thing on this screen. */}
        {requireApproval && (
          <PendingApprovalsPanel
            pending={pendingApprovals}
            onApprove={approveStudents}
            onReject={rejectStudents}
            loading={loading}
          />
        )}

        {/* Class Link Management */}
        <ClassLinkManager
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
                  onBlock={blockStudent}
                  onUnblock={unblockStudent}
                  onApprove={approveReceipt}
                  onDecline={declineReceipt}
                  loading={loading}
                />
              ) : (
                <StudentTable
                  session="evening"
                  students={eveningStudents}
                  onDelete={deleteStudent}
                  onEdit={updateStudent}
                  onExport={exportToPDF}
                  onBlock={blockStudent}
                  onUnblock={unblockStudent}
                  onApprove={approveReceipt}
                  onDecline={declineReceipt}
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
