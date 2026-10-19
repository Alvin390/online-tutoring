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
import HelpFeedbackButton from '@features/reports/components/HelpFeedbackButton';

// Lazy: the calendar carries a month grid, an agenda and a recurrence form the
// dashboard should not pay for on first paint. It never enters the initial chunk.
const CalendarPanel = lazy(() => import('@features/calendar/components/CalendarPanel'));
const WhatsAppPanel = lazy(() => import('@features/whatsapp/components/WhatsAppPanel'));
import StudentTable from './StudentTable';
import { useDashboard } from '../hooks/useDashboard';
import { useFlag } from '@shared/config/FlagsContext';
import TierGate from '@shared/components/TierGate';
import { ROUTES } from '@/routes/routeConfig';

export default function DashboardLayout() {
  const navigate = useNavigate();
  const { user } = useAuthState();
  const { signOut } = useAuthActions();
  const {
    studentsBySession,
    sessions,
    tabs,
    pendingApprovals,
    classLinks,
    loading,
    activeTab,
    setActiveTab,
    updateClassLink,
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

  // Phase 13 / 02 D7: counted over the active sessions, however many there are.
  const activeSessions = sessions.filter((s) => s.active !== false);
  const linksConfigured = activeSessions.filter((s) => classLinks[s.id]?.url).length;
  const currentStudents = activeTab ? (studentsBySession[activeTab] ?? []) : [];

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
              {/* Always present, not only when a feature is locked. Managing a
                  subscription — seeing the renewal date, changing plan,
                  cancelling — is not an upsell, and routing to it only through
                  an upgrade prompt means a Gold teacher has no way to reach
                  their own billing at all. */}
              <button
                className="btn btn-outline-light"
                onClick={() => navigate(ROUTES.BILLING)}
                title="Manage your subscription"
              >
                <i className="bi bi-credit-card me-1" aria-hidden="true" />
                Billing
              </button>
              <HelpFeedbackButton />
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
          linksTotal={activeSessions.length}
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

        {/* Sessions (Phase 05; always shown since Phase 13 / 02 — morning and
            evening are ordinary, editable sessions now, so the panel is how a
            teacher sets their times and homepage details). Bronze, matching
            api/sessions/manage.js. */}
        <TierGate
          tier="bronze"
          feature="Sessions"
          description="Edit your class times and run more than one session"
        >
          <SessionManager />
        </TierGate>

        {/* Class Link Management — one slot per session (Phase 13 / 02 D4). */}
        <ClassLinkManager
          sessions={sessions}
          classLinks={classLinks}
          onUpdate={updateClassLink}
          loading={loading}
        />

        {/* Students Management */}
        <div className="card animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          {/* One tab per session (Phase 13 / 02 D7): active sessions in the
              teacher's order, then hidden sessions that still have students.
              Scrolls sideways on a phone rather than wrapping. */}
          <div className="card-header bg-white border-0 dashboard-session-tabs">
            <ul className="nav nav-tabs card-header-tabs mb-0 flex-nowrap" role="tablist">
              {tabs.map((session) => (
                <li className="nav-item" key={session.id} role="presentation">
                  <button
                    type="button"
                    role="tab"
                    id={`tab-${session.id}`}
                    aria-selected={activeTab === session.id}
                    aria-controls="session-tabpanel"
                    className={`nav-link text-nowrap ${activeTab === session.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(session.id)}
                  >
                    <i className={`bi ${session.icon ?? 'bi-book-fill'} me-2`} aria-hidden="true" />
                    {session.name} (<span className="fw-bold">{studentsBySession[session.id]?.length ?? 0}</span>)
                    {session.active === false && (
                      <span className="badge text-bg-secondary ms-2">Hidden</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="card-body p-0">
            <div className="tab-content p-4" id="session-tabpanel" role="tabpanel" aria-labelledby={activeTab ? `tab-${activeTab}` : undefined}>
              {activeTab ? (
                <StudentTable
                  key={activeTab}
                  session={activeTab}
                  students={currentStudents}
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
                !loading && <p className="text-muted text-center mb-0">No sessions yet — create one above.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
