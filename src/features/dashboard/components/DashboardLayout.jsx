import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { m } from 'framer-motion';
import { useAuthState, useAuthActions } from '@features/auth/context/AuthContext';
import IdleWarningModal from '@features/auth/components/IdleWarningModal';
import useIdleTimeout from '@hooks/useIdleTimeout';
import StatsCards from './StatsCards';
import ClassLinkManager from './ClassLinkManager';
import SessionManager from './SessionManager';
import FeeKpiCards from '@features/fees/components/FeeKpiCards';
import HelpFeedbackButton from '@features/reports/components/HelpFeedbackButton';

// Lazy: the calendar carries a month grid, an agenda and a recurrence form the
// dashboard should not pay for on first paint. It never enters the initial chunk.
const CalendarPanel = lazy(() => import('@features/calendar/components/CalendarPanel'));
const WhatsAppPanel = lazy(() => import('@features/whatsapp/components/WhatsAppPanel'));
// Lazy too (001Fixes / 05): the student drawer opens on a click, so it need not
// be in the dashboard's first download. Fetched when the browser is idle after
// the dashboard has loaded, so the first click rarely waits.
const loadStudentDrawer = () => import('./StudentDrawer');
const StudentDrawer = lazy(loadStudentDrawer);
// Lazy (002Fixes / 08): only shown when approval is on, and its pre-class
// banner must not grow the dashboard's first download (budgeted at 260 KB).
const PendingApprovalsPanel = lazy(() => import('./PendingApprovalsPanel'));
import StudentSearchPanel from './StudentSearchPanel';
import { useDashboard } from '../hooks/useDashboard';
import { useWaitingTitle } from '../hooks/useWaitingTitle';
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
  // Mounted from the first open onwards, so its closing animation still plays.
  const [drawerMounted, setDrawerMounted] = useState(false);
  useEffect(() => { if (drawerStudent) setDrawerMounted(true); }, [drawerStudent]);
  useEffect(() => {
    const prefetch = () => { loadStudentDrawer().catch(() => {}); };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(prefetch, { timeout: 5000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(prefetch, 2000);
    return () => clearTimeout(timer);
  }, []);

  const [refreshing, setRefreshing] = useState(false);

  // Sign-out wipes the offline cache and reloads (Phase 13 / 08 B5), so the
  // destination is passed in rather than navigated to afterwards.
  const handleLogout = useCallback(async () => {
    await signOut({ redirectTo: '/' });
  }, [signOut]);

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

  // 002Fixes / 08: the waiting count in the tab title.
  useWaitingTitle(requireApproval ? (pendingApprovals?.length ?? 0) : 0);
  const linksConfigured = activeSessions.filter((s) => classLinks[s.id]?.url).length;
  const currentStudents = activeTab ? (studentsBySession[activeTab] ?? []) : [];

  return (
    <m.div
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

      {drawerMounted && (
        <Suspense fallback={null}>
          <StudentDrawer
            open={Boolean(drawerStudent)}
            student={drawerStudent}
            // The row's own session in the all-sessions view (001Fixes / 06).
            session={drawerStudent?.__session ?? drawerStudent?.session ?? activeTab}
            onClose={() => setDrawerStudent(null)}
          />
        </Suspense>
      )}

      {/* Dashboard Header */}
      <div className="dashboard-header text-white py-3 sticky-top">
        <div className="container-fluid">
          {/* Phase 13 / 07: must never be wider than a phone. A header that
              overflowed widened the mobile LAYOUT viewport, and every fixed
              overlay (the student popup, toasts) was then centred in that
              wider box — off-screen to the right (I5). Labels collapse to
              icons below `sm`, and the row may wrap. */}
          <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
            <div className="d-flex align-items-center gap-3" style={{ minWidth: 0 }}>
              <i className="bi bi-speedometer2 fs-3" />
              <div>
                <h4 className="mb-0 fw-bold">Teacher Dashboard</h4>
                <small className="opacity-75">Student Registration Management</small>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 gap-md-3 flex-wrap justify-content-end">
              <button
                className="btn btn-light btn-sm"
                onClick={handleRefresh}
                disabled={refreshing}
                aria-label="Refresh"
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
                aria-label="Billing"
              >
                <i className="bi bi-credit-card me-sm-1" aria-hidden="true" />
                <span className="d-none d-sm-inline">Billing</span>
              </button>
              <HelpFeedbackButton compact />
              <button className="btn btn-light" onClick={handleLogout} aria-label="Logout">
                <i className="bi bi-box-arrow-right me-sm-1" aria-hidden="true" />
                <span className="d-none d-sm-inline">Logout</span>
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
          <Suspense fallback={null}>
            <PendingApprovalsPanel
              pending={pendingApprovals}
              onApprove={approveStudents}
              onReject={rejectStudents}
              loading={loading}
              sessions={activeSessions}
            />
          </Suspense>
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
                <StudentSearchPanel
                  session={activeTab}
                  sessions={tabs}
                  studentsBySession={studentsBySession}
                  sessionDoc={sessions.find((s) => s.id === activeTab) ?? null}
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
    </m.div>
  );
}
