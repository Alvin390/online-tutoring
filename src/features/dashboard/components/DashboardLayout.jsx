import { useState, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuthState, useAuthActions } from '@features/auth/context/AuthContext';
import IdleWarningModal from '@features/auth/components/IdleWarningModal';
import useIdleTimeout from '@hooks/useIdleTimeout';
import StatsCards from './StatsCards';
import ClassLinkManager from './ClassLinkManager';
import PendingApprovalsPanel from './PendingApprovalsPanel';
import SessionManager from './SessionManager';
import StudentDrawer from './StudentDrawer';
import FeeKpiCards from '@features/fees/components/FeeKpiCards';

// Lazy: the calendar carries a month grid, an agenda and a recurrence form the
// dashboard should not pay for on first paint. It never enters the initial chunk.
const CalendarPanel = lazy(() => import('@features/calendar/components/CalendarPanel'));
const WhatsAppPanel = lazy(() => import('@features/whatsapp/components/WhatsAppPanel'));
import StudentTable from './StudentTable';
import { useDashboard } from '../hooks/useDashboard';
import { useFlag } from '@shared/config/FlagsContext';
import TierGate from '@shared/components/TierGate';

export default function DashboardLayout() {
  const navigate = useNavigate();
  const { user } = useAuthState();
  const { signOut } = useAuthActions();
  const {
    studentsBySession,
    sessions,
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
  const teacherDefinedSessions = useFlag('sessions.teacherDefined');
  const notesEnabled = useFlag('notes.enabled');
  const feesEnabled = useFlag('fees.enabled');
  const calendarEnabled = useFlag('calendar.enabled');
  const whatsappEnabled = useFlag('whatsapp.broadcast');

  // Which student the detail drawer is showing, and from which session.
  const [drawerStudent, setDrawerStudent] = useState(null);

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

      <StudentDrawer
        open={Boolean(drawerStudent)}
        student={drawerStudent}
        session={drawerStudent?.session ?? activeTab}
        onClose={() => setDrawerStudent(null)}
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
          studentsBySession={studentsBySession}
          sessions={sessions}
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

        {/* Fee KPIs (Phase 06). One aggregate document read, not a scan.
            Silver, matching api/fees/*.js. */}
        {feesEnabled && (
          <TierGate
            tier="silver"
            feature="Fee ledger and invoicing"
            description="Record payments, issue invoices and see who is behind"
          >
            <FeeKpiCards />
          </TierGate>
        )}

        {/* WhatsApp broadcast (Phase 08), lazily loaded.
            Silver, matching api/whatsapp/campaign.js. The gate sits OUTSIDE the
            Suspense so a Bronze teacher never downloads the chunk. */}
        {whatsappEnabled && (
          <TierGate
            tier="silver"
            feature="WhatsApp broadcast"
            description="Message every student at once, with no per-message cost"
          >
            <Suspense
              fallback={
                <div className="card mb-4">
                  <div className="card-body text-center py-4">
                    <span className="spinner-border spinner-border-sm text-muted" />
                  </div>
                </div>
              }
            >
              <WhatsAppPanel />
            </Suspense>
          </TierGate>
        )}

        {/* Calendar (Phase 07), lazily loaded.
            Silver, matching api/calendar/manage.js and feedToken.js. */}
        {calendarEnabled && (
          <TierGate
            tier="silver"
            feature="Class calendar"
            description="Plan the term with weekly recurrence and an .ics feed"
          >
            <Suspense
              fallback={
                <div className="card mb-4">
                  <div className="card-body text-center py-4">
                    <span className="spinner-border spinner-border-sm text-muted" />
                  </div>
                </div>
              }
            >
              <CalendarPanel />
            </Suspense>
          </TierGate>
        )}

        {/* Sessions (Phase 05). Behind a flag: with it off the two original
            sessions are managed through ClassLinkManager exactly as before.
            Bronze, matching api/sessions/manage.js — so in practice every
            paying teacher passes. The gate is here so the rule stays written
            down next to the panel it governs. */}
        {teacherDefinedSessions && (
          <TierGate
            tier="bronze"
            feature="Custom sessions"
            description="Run more than the two built-in class times"
          >
            <SessionManager />
          </TierGate>
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
                  onView={notesEnabled ? setDrawerStudent : undefined}
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
                  onView={notesEnabled ? setDrawerStudent : undefined}
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
