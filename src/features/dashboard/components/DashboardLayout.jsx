import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useWhatsappPreset } from '@features/whatsapp/whatsappPreset';
import { m } from 'framer-motion';
import { useAuthState, useAuthActions } from '@features/auth/context/AuthContext';
import IdleWarningModal from '@features/auth/components/IdleWarningModal';
import useIdleTimeout from '@hooks/useIdleTimeout';
import { partialSummary } from '@features/fees/partialSummary';
import { useDashboard } from '../hooks/useDashboard';
import { useWaitingTitle } from '../hooks/useWaitingTitle';
import { useFlag, useFlagsLoaded } from '@shared/config/FlagsContext';
import StudentsTab from '../tabs/StudentsTab';
import DashboardNav from '../nav/DashboardNav';
import BottomNav from '../nav/BottomNav';
import WaitingBanner from '../nav/WaitingBanner';
import { visibleTabs, tabPath, tabFromPath, DEFAULT_TAB } from '../nav/dashboardTabs';
import { useOptionalToast } from '@/context/ToastContext';
import { otherRecords, markedToast } from '../staff/markStaffText';

// Lazy too (001Fixes / 05): the student drawer opens on a click, so it need not
// be in the dashboard's first download. Fetched when the browser is idle after
// the dashboard has loaded, so the first click rarely waits.
const loadStudentDrawer = () => import('./StudentDrawer');
const StudentDrawer = lazy(loadStudentDrawer);
// 006Fixes / 06: Complete or Partial, when approving the receipt of someone who owes.
const loadApprovePaymentModal = () => import('./ApprovePaymentModal');
const ApprovePaymentModal = lazy(loadApprovePaymentModal);
// 007Fixes / 09: "Mark … as staff?", prefetched when idle.
const loadMarkStaffDialog = () => import('../staff/MarkStaffDialog');
const MarkStaffDialog = lazy(loadMarkStaffDialog);

/**
 * 007Fixes / 03: every tab but Students is its own chunk, so the dashboard's
 * first download carries only the frame and the student list. The others are
 * fetched when the browser is idle (and on hover/focus of their tab), so a tab
 * switch rarely waits.
 */
const TAB_LOADERS = {
  approvals: () => import('../tabs/ApprovalsTab'),
  fees: () => import('../tabs/FeesOverviewTab'),
  whatsapp: () => import('../tabs/WhatsAppTab'),
  staff: () => import('../tabs/StaffTab'),
  calendar: () => import('../tabs/CalendarTab'),
  setup: () => import('../tabs/SetupTab'),
};
const ApprovalsTab = lazy(TAB_LOADERS.approvals);
const FeesOverviewTab = lazy(TAB_LOADERS.fees);
const WhatsAppTab = lazy(TAB_LOADERS.whatsapp);
const StaffTab = lazy(TAB_LOADERS.staff);
const CalendarTab = lazy(TAB_LOADERS.calendar);
const SetupTab = lazy(TAB_LOADERS.setup);
const prefetchTab = (id) => { TAB_LOADERS[id]?.().catch(() => {}); };

const TabFallback = () => (
  <div className="text-center py-5">
    <span className="spinner-border spinner-border-sm text-muted" role="status" aria-label="Loading" />
  </div>
);

/**
 * The teacher dashboard — since 007Fixes / 03 a FRAME with tabs.
 *
 * Everything that must not restart when the tab changes lives here: the data
 * hook (one roster listener per session, pending approvals, class links), the
 * student drawer, the approve-payment pop-up, the idle timeout and the tab
 * title. The tabs are routes under `/dashboard/*` rendered inside this frame,
 * so switching tabs never re-subscribes a listener (tested).
 */
export default function DashboardLayout() {
  const location = useLocation();
  const { user } = useAuthState();
  const { signOut } = useAuthActions();
  const {
    studentsBySession,
    sessions,
    tabs: sessionTabs,
    pendingApprovals,
    classLinks,
    loading,
    // The per-session tabs inside Students; not the dashboard's own tabs.
    activeTab: activeSession,
    setActiveTab: setActiveSession,
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
    // 007Fixes / 09-10: staff, split from the same rosters.
    staffBySession,
  } = useDashboard();

  const requireApproval = useFlag('registration.requireApproval');
  const notesEnabled = useFlag('notes.enabled');
  const feesEnabled = useFlag('fees.enabled');
  const whatsappEnabled = useFlag('whatsapp.broadcast');
  const calendarEnabled = useFlag('calendar.enabled');
  const flagsLoaded = useFlagsLoaded();
  const whatsappPreset = useWhatsappPreset();

  const flagOn = useMemo(() => ({
    'registration.requireApproval': requireApproval,
    'fees.enabled': feesEnabled,
    'whatsapp.broadcast': whatsappEnabled,
    'calendar.enabled': calendarEnabled,
  }), [requireApproval, feesEnabled, whatsappEnabled, calendarEnabled]);
  const navTabs = useMemo(() => visibleTabs((flag) => flagOn[flag] === true), [flagOn]);
  const shown = useMemo(() => new Set(navTabs.map((t) => t.id)), [navTabs]);
  const currentTab = tabFromPath(location.pathname);

  /**
   * 006Fixes / 06 (owner): approving the receipt of someone who owes asks
   * Complete or Partial first. Nothing owed (or fees off): approved at once,
   * as before. Resolves when the pop-up is done, so the row's popup closes
   * only then.
   */
  const handleApprove = useCallback((session, id, name, student) => {
    const owed = Number(student?.feeBalance) || 0;
    if (!feesEnabled || owed <= 0) return approveReceipt(session, id, name);
    return new Promise((resolve) => setApproving({ session, id, name, student, owed, resolve }));
  }, [feesEnabled, approveReceipt]);
  const closeApproving = useCallback((result = { success: false }) => {
    setApproving((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);
  useEffect(() => {
    if (!feesEnabled) return undefined;
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 2500));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    const handle = idle(() => { loadApprovePaymentModal().catch(() => {}); });
    return () => cancel(handle);
  }, [feesEnabled]);

  // Which student the detail drawer is showing, and from which session.
  const [drawerStudent, setDrawerStudent] = useState(null);
  // 006Fixes / 06: the receipt being approved ({ session, id, name, student, resolve }).
  const [approving, setApproving] = useState(null);
  // Mounted from the first open onwards, so its closing animation still plays.
  const [drawerMounted, setDrawerMounted] = useState(false);
  useEffect(() => { if (drawerStudent) setDrawerMounted(true); }, [drawerStudent]);

  // Idle prefetch: the drawer (001Fixes / 05) and the other tabs (007Fixes / 03).
  useEffect(() => {
    const prefetch = () => {
      loadStudentDrawer().catch(() => {});
      loadMarkStaffDialog().catch(() => {});
      for (const id of Object.keys(TAB_LOADERS)) prefetchTab(id);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(prefetch, { timeout: 5000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(prefetch, 2000);
    return () => clearTimeout(timer);
  }, []);

  const [refreshing, setRefreshing] = useState(false);

  /**
   * Mark as staff — 007Fixes / 09. The edit view's switch and the selection
   * bar hand over [{ session, phone, name, balance }]; the frame finds the same
   * numbers in other sessions (from the rosters it already holds), asks, marks
   * and says what was closed. The roster listener then moves them across.
   */
  const toast = useOptionalToast();
  const [staffAsk, setStaffAsk] = useState(null);
  const [staffBusy, setStaffBusy] = useState(false);
  const sessionNames = useMemo(() => Object.fromEntries(sessions.map((x) => [x.id, x.name ?? x.id])), [sessions]);
  const askMarkStaff = useCallback((people, done) => {
    if (!people?.length) return;
    setStaffAsk({
      people: people.map((p) => ({ ...p, sessionName: sessionNames[p.session] ?? p.session })),
      others: otherRecords(people, studentsBySession, sessionNames),
      done,
    });
  }, [sessionNames, studentsBySession]);
  const confirmMarkStaff = async ({ alsoOtherSession }) => {
    if (!staffAsk) return;
    setStaffBusy(true);
    try {
      // On demand: the students service is its own lazy chunk (bulk actions);
      // a static import here put all of it in the dashboard's first download.
      const { markStaff } = await import('@services/api/students');
      const result = await markStaff(staffAsk.people.map(({ session, phone }) => ({ session, phone })), { alsoOtherSession });
      toast?.showSuccess(markedToast(result));
      staffAsk.done?.();
      setStaffAsk(null);
    } catch (error) {
      toast?.showError(error?.message ?? 'Could not mark as staff. Please try again.');
    } finally {
      setStaffBusy(false);
    }
  };

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
  const waiting = requireApproval ? (pendingApprovals ?? []) : [];
  useWaitingTitle(waiting.length);
  const linksConfigured = activeSessions.filter((s) => classLinks[s.id]?.url).length;
  const currentStudents = activeSession ? (studentsBySession[activeSession] ?? []) : [];
  // 006Fixes / 08: who is on a partial payment, from the rosters already loaded
  // (once per roster update; no extra read).
  const partial = useMemo(() => (feesEnabled ? partialSummary(studentsBySession) : null), [feesEnabled, studentsBySession]);

  const actions = {
    deleteStudent,
    updateStudent,
    exportToPDF,
    blockStudent,
    unblockStudent,
    declineReceipt,
    approve: handleApprove,
    onView: notesEnabled ? setDrawerStudent : undefined,
    markStaff: askMarkStaff,
  };

  // A tab that is hidden (flag off) or unknown opens Students, keeping the
  // address's filters for the student list.
  const toStudents = <Navigate to={{ pathname: tabPath(DEFAULT_TAB), search: location.search }} replace />;
  // Until the flags arrive, a tab that reads as hidden may only be on the
  // defaults: wait rather than leave it (a refresh on Approvals landed on
  // Students — 007Fixes / 06).
  const only = (id, element) => {
    if (shown.has(id)) return element;
    return flagsLoaded ? toStudents : <TabFallback />;
  };

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
            session={drawerStudent?.__session ?? drawerStudent?.session ?? activeSession}
            onClose={() => setDrawerStudent(null)}
          />
        </Suspense>
      )}

      <DashboardNav
        tabs={navTabs}
        waitingCount={waiting.length}
        email={user?.email}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onLogout={handleLogout}
        onPrefetch={prefetchTab}
      />

      <main className="container-fluid py-3 py-md-4 dashboard-tab-content">
        {currentTab && currentTab !== 'approvals' && shown.has('approvals') && (
          <WaitingBanner pending={waiting} sessions={activeSessions} />
        )}

        <Suspense fallback={<TabFallback />}>
          <Routes>
            <Route index element={toStudents} />
            <Route
              path="students"
              element={(
                <StudentsTab
                  studentsBySession={studentsBySession}
                  sessions={sessions}
                  sessionTabs={sessionTabs}
                  totalStudents={totalStudents}
                  linksConfigured={linksConfigured}
                  linksTotal={activeSessions.length}
                  activeSession={activeSession}
                  setActiveSession={setActiveSession}
                  currentStudents={currentStudents}
                  loading={loading}
                  actions={actions}
                />
              )}
            />
            <Route
              path="approvals"
              element={only('approvals', (
                <ApprovalsTab
                  pending={pendingApprovals}
                  rosters={studentsBySession}
                  onApprove={approveStudents}
                  onReject={rejectStudents}
                  loading={loading}
                  sessions={activeSessions}
                />
              ))}
            />
            <Route path="fees" element={only('fees', <FeesOverviewTab sessions={activeSessions} partial={partial} />)} />
            <Route path="whatsapp" element={only('whatsapp', <WhatsAppTab preset={whatsappPreset} />)} />
            <Route
              path="staff"
              element={only('staff', (
                <StaffTab staffBySession={staffBySession} sessions={sessions} onEdit={updateStudent} onDelete={deleteStudent} />
              ))}
            />
            <Route path="calendar" element={only('calendar', <CalendarTab />)} />
            <Route
              path="setup"
              element={only('setup', (
                <SetupTab sessions={sessions} classLinks={classLinks} onUpdateLink={updateClassLink} loading={loading} />
              ))}
            />
            <Route path="*" element={toStudents} />
          </Routes>
        </Suspense>
      </main>

      {/* 007Fixes / 04: below 768 px the tabs live in a bottom bar (CSS-hidden above). */}
      <BottomNav tabs={navTabs} waitingCount={waiting.length} onLogout={handleLogout} />

      {staffAsk && (
        <Suspense fallback={null}>
          <MarkStaffDialog
            people={staffAsk.people}
            others={staffAsk.others}
            busy={staffBusy}
            onCancel={() => { if (!staffBusy) setStaffAsk(null); }}
            onConfirm={confirmMarkStaff}
          />
        </Suspense>
      )}

      {approving && (
        <Suspense fallback={null}>
          <ApprovePaymentModal
            studentName={approving.name}
            sessionName={sessions.find((x) => x.id === approving.session)?.name ?? approving.session}
            receipt={approving.student?.pendingReceipt || approving.student?.receiptMessage || ''}
            owed={approving.owed}
            onClose={() => closeApproving()}
            onConfirm={async (choice) => {
              const result = await approveReceipt(approving.session, approving.id, approving.name, choice);
              if (result?.success) closeApproving(result);
              return result;
            }}
          />
        </Suspense>
      )}
    </m.div>
  );
}
