import { lazy, Suspense } from 'react';
import StatsCards from '../components/StatsCards';
import { useFlag } from '@shared/config/FlagsContext';

// 008Fixes / 05: with approvals off there is no Approvals tab, so the waiting
// codes sit here (lazy; read when opened).
const WaitingCodesPanel = lazy(() => import('../components/admission/WaitingCodesPanel'));
// 009Fixes / 04: numbers students changed themselves (here when approvals are off).
const NumberFixesPanel = lazy(() => import('../components/admission/NumberFixesPanel'));
import StudentSearchPanel from '../components/StudentSearchPanel';

/**
 * Students — the dashboard's default tab (007Fixes / 03). In the route chunk,
 * not lazy: it is what the teacher opens the dashboard for.
 *
 * The per-session tabs inside it are the existing session tabs (Phase 13 / 02
 * D7), named `activeSession` here so they are never confused with the
 * dashboard's own navigation tabs.
 */
export default function StudentsTab({
  studentsBySession,
  sessions,
  sessionTabs,
  totalStudents,
  linksConfigured,
  linksTotal,
  activeSession,
  setActiveSession,
  currentStudents,
  loading,
  actions,
}) {
  const numbers = useFlag('checkin.admissionNumbers');
  const approvals = useFlag('registration.requireApproval');
  return (
    <>
      {numbers && !approvals && (
        <Suspense fallback={null}>
          <WaitingCodesPanel sessionNames={Object.fromEntries(sessions.map((s) => [s.id, s.name ?? s.id]))} />
        </Suspense>
      )}
      {numbers && !approvals && (
        <Suspense fallback={null}>
          <NumberFixesPanel
            rosters={studentsBySession}
            sessionNames={Object.fromEntries(sessions.map((s) => [s.id, s.name ?? s.id]))}
            onOpen={actions?.onView}
          />
        </Suspense>
      )}
      {/* Owner review of Release A (2026-11-12): the stats cards stay. */}
      <StatsCards
        studentsBySession={studentsBySession}
        sessions={sessions}
        totalCount={totalStudents}
        linksConfigured={linksConfigured}
        linksTotal={linksTotal}
      />

      <div className="card">
        {/* One tab per session (Phase 13 / 02 D7): active sessions in the
            teacher's order, then hidden sessions that still have students.
            Scrolls sideways on a phone rather than wrapping. */}
        <div className="card-header bg-white border-0 dashboard-session-tabs">
          <ul className="nav nav-tabs card-header-tabs mb-0 flex-nowrap" role="tablist">
            {sessionTabs.map((session) => (
              <li className="nav-item" key={session.id} role="presentation">
                <button
                  type="button"
                  role="tab"
                  id={`tab-${session.id}`}
                  aria-selected={activeSession === session.id}
                  aria-controls="session-tabpanel"
                  className={`nav-link text-nowrap ${activeSession === session.id ? 'active' : ''}`}
                  onClick={() => setActiveSession(session.id)}
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
          <div className="tab-content p-3 p-md-4" id="session-tabpanel" role="tabpanel" aria-labelledby={activeSession ? `tab-${activeSession}` : undefined}>
            {activeSession ? (
              <StudentSearchPanel
                session={activeSession}
                sessions={sessionTabs}
                studentsBySession={studentsBySession}
                sessionDoc={sessions.find((s) => s.id === activeSession) ?? null}
                students={currentStudents}
                onDelete={actions.deleteStudent}
                onEdit={actions.updateStudent}
                onView={actions.onView}
                onExport={actions.exportToPDF}
                onBlock={actions.blockStudent}
                onUnblock={actions.unblockStudent}
                onApprove={actions.approve}
                onDecline={actions.declineReceipt}
                onMarkStaff={actions.markStaff}
                loading={loading}
              />
            ) : (
              !loading && <p className="text-muted text-center mb-0">No sessions yet. Create one in Setup.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
