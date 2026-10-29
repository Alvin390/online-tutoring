import { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { nextClassWindow } from '@utils/classTime';
import { retiredMessage, matchReasons } from '@utils/duplicates';
import { declineDuplicate } from '@services/api/students';
import { useOptionalToast } from '@/context/ToastContext';
import { matchedLine, suffixOf } from '../duplicates/duplicatePairs';

// 003Fixes / 13: the side-by-side view, loaded when Compare is pressed.
const DuplicatePair = lazy(() => import('./duplicates/DuplicatePair'));

/**
 * Before-class urgency — 002Fixes / 08. On 26 Oct students were approved
 * during the evening class (19:41, 19:50) while new ones sat on the waiting
 * screen. From two hours before a class, a session with students waiting gets
 * a banner with its own Approve-all; inside 30 minutes it turns amber.
 */
const BANNER_LEAD_MS = 2 * 60 * 60 * 1000;
const URGENT_MS = 30 * 60 * 1000;

/** "in 25 min", "in 1 h 05 min", "10 min ago" — whole minutes, never 0 for a future start. */
export function relativeStart(start, now) {
  const minutes = Math.round(Math.abs(start - now) / 60_000);
  if (start <= now) return `started ${minutes} min ago`;
  const shown = Math.max(1, minutes);
  return shown >= 60
    ? `starts in ${Math.floor(shown / 60)} h ${String(shown % 60).padStart(2, '0')} min`
    : `starts in ${shown} min`;
}

/** Re-renders every 30 s so the minutes stay true. */
function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Pending approvals queue — Phase 04 Part A.
 *
 * Fed by a `collectionGroup('students')` query on `approvalStatus`, so it spans
 * every session in one listener rather than one per session. That query needs
 * BOTH the COLLECTION_GROUP-scoped index in firestore.indexes.json AND the
 * wildcard rules match — see Phase 01 D1. Missing either fails at runtime with
 * a permission error that never mentions collection groups.
 *
 * Interaction notes:
 *   - Rejection requires a reason of at least 10 characters, enforced here for
 *     immediate feedback and again in the API, which is the real control.
 *   - Bulk approve lists every name before confirming. A destructive or
 *     hard-to-reverse action that does not name what it affects is how people
 *     approve twenty students they meant to review.
 */
export default function PendingApprovalsPanel({ pending, onApprove, onReject, loading, sessions = [], rosters = null }) {
  const [rejectingPhone, setRejectingPhone] = useState(null);
  const [reason, setReason] = useState('');
  // What a bulk approval would cover: null (none open), 'all', or one
  // session's id (its pre-class banner, 002Fixes / 08).
  const [confirmScope, setConfirmScope] = useState(null);
  const [busy, setBusy] = useState(false);
  // 003Fixes / 13: a held duplicate being declined, or compared side by side.
  const [decliningId, setDecliningId] = useState(null);
  const [comparingId, setComparingId] = useState(null);
  const toast = useOptionalToast();
  const now = useClock();

  const count = pending?.length ?? 0;
  // Held duplicates need a decision each, so "Approve all" leaves them out.
  const held = (pending ?? []).filter((s) => s.duplicateHold === true);
  const approvable = (pending ?? []).filter((s) => s.duplicateHold !== true);
  const originalOf = (student) => (rosters?.[student.session] ?? []).find((s) => (s.parentPhone ?? s.id) === student.duplicateOf) ?? null;
  const grouped = useMemo(() => {
    const map = new Map();
    for (const student of pending ?? []) {
      if (student.duplicateHold === true) continue;
      if (!map.has(student.session)) map.set(student.session, []);
      map.get(student.session).push(student);
    }
    return map;
  }, [pending]);

  // Sessions whose class is within two hours (or running) and have students waiting.
  const soon = useMemo(() => sessions.flatMap((session) => {
    const waiting = grouped.get(session.id);
    if (!waiting?.length) return [];
    const window = nextClassWindow(session.schedule, now);
    if (!window || window.start - now > BANNER_LEAD_MS) return [];
    return [{ session, waiting, window }];
  }), [sessions, grouped, now]);

  const confirmList = confirmScope === 'all' ? approvable : (grouped.get(confirmScope) ?? []);
  const scopeName = (id) => sessions.find((x) => x.id === id)?.name ?? id;

  const handleApprove = async (student) => {
    setBusy(true);
    await onApprove(student.session, [student.id]);
    setBusy(false);
  };

  const handleReject = async (student) => {
    if (reason.trim().length < 10) return;
    setBusy(true);
    await onReject(student.session, [student.id], reason.trim());
    setRejectingPhone(null);
    setReason('');
    setBusy(false);
  };

  const handleDecline = async (student) => {
    setBusy(true);
    try {
      await declineDuplicate(student.session, student.id);
      toast?.showSuccess(`${suffixOf(student.id)} declined as a duplicate.`, 'Possible duplicate');
      setDecliningId(null);
    } catch (err) {
      toast?.showError(err?.message ?? 'Could not decline that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkApprove = async () => {
    setBusy(true);
    // One call per session, because the API is session-scoped — and because a
    // partial failure should not span sessions.
    for (const [session, students] of grouped.entries()) {
      if (confirmScope !== 'all' && session !== confirmScope) continue;
      await onApprove(session, students.map((s) => s.id));
    }
    setConfirmScope(null);
    setBusy(false);
  };

  // Zero state. Explains what will appear here rather than rendering nothing,
  // so an empty queue reads as "working" instead of "broken".
  if (!loading && count === 0) {
    return (
      <div className="card mb-4">
        <div className="card-body text-center py-4">
          <i
            className="bi bi-inbox text-muted d-block mb-2"
            style={{ fontSize: '2rem' }}
            aria-hidden="true"
          />
          <h6 className="fw-bold mb-1">No one waiting for approval</h6>
          <p className="text-muted small mb-0">
            New students appear here after they register, and stay out of class until
            you approve them.
          </p>
        </div>
      </div>
    );
  }

  return (
    <m.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card mb-4 border-warning"
    >
      <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h5 className="mb-0">
          <i className="bi bi-person-check-fill me-2" aria-hidden="true" />
          Waiting for approval
          <span className="badge text-bg-warning ms-2" aria-live="polite">
            {count}
          </span>
        </h5>

        {approvable.length > 1 && (
          <button
            className="btn btn-sm btn-outline-success"
            onClick={() => setConfirmScope('all')}
            disabled={busy}
          >
            <i className="bi bi-check2-all me-1" aria-hidden="true" />
            {held.length > 0
              ? `Approve all ${approvable.length} (${held.length} possible duplicate${held.length === 1 ? ' needs' : 's need'} a look)`
              : `Approve all (${approvable.length})`}
          </button>
        )}
      </div>

      {/* Before-class banners (002Fixes / 08): one per session that is close. */}
      {soon.map(({ session, waiting, window }) => {
        const urgent = window.start - now <= URGENT_MS;
        return (
          <div
            key={session.id}
            className={`alert ${urgent ? 'alert-warning' : 'alert-info'} rounded-0 mb-0 border-0 border-bottom d-flex justify-content-between align-items-center flex-wrap gap-2`}
            role="status"
            data-testid="preclass-banner"
          >
            <span>
              <i className={`bi ${urgent ? 'bi-alarm' : 'bi-clock'} me-2`} aria-hidden="true" />
              <strong>{session.name ?? session.id} class {relativeStart(window.start, now)}</strong>
              {' — '}
              {waiting.length} student{waiting.length === 1 ? '' : 's'} {window.start <= now ? 'still ' : ''}waiting.
            </span>
            <button
              className={`btn btn-sm ${urgent ? 'btn-warning' : 'btn-outline-primary'}`}
              onClick={() => setConfirmScope(session.id)}
              disabled={busy}
            >
              <i className="bi bi-check2-all me-1" aria-hidden="true" />
              Approve {waiting.length === 1 ? waiting[0].studentName : `all ${waiting.length}`}
            </button>
          </div>
        );
      })}

      {/* Bulk confirmation names every student, per the destructive-action rule. */}
      {confirmScope && (
        <div className="card-body border-bottom bg-light">
          <p className="fw-semibold mb-2">
            {confirmScope === 'all'
              ? `Approve all ${approvable.length} students?`
              : `Approve ${confirmList.length} student${confirmList.length === 1 ? '' : 's'} for ${scopeName(confirmScope)}?`}
          </p>
          <ul className="small mb-3" style={{ maxHeight: 160, overflowY: 'auto' }}>
            {confirmList.map((s) => (
              <li key={`${s.session}-${s.id}`}>
                {s.studentName} — {s.class} ({s.session})
              </li>
            ))}
          </ul>
          <div className="d-flex gap-2">
            <button className="btn btn-success btn-sm" onClick={handleBulkApprove} disabled={busy}>
              Yes, approve all
            </button>
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setConfirmScope(null)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card-body p-0">
        <AnimatePresence initial={false}>
          {(pending ?? []).map((student) => (
            <m.div
              key={`${student.session}-${student.id}`}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0 }}
              className={`border-bottom p-3${student.duplicateHold === true ? ' pending-duplicate' : ''}`}
              data-testid={student.duplicateHold === true ? 'pending-duplicate' : undefined}
            >
              <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                <div className="flex-grow-1" style={{ minWidth: 220 }}>
                  <div className="fw-bold">
                    {student.studentName}
                    <span className="badge text-bg-light text-muted ms-2 text-capitalize">
                      {student.session}
                    </span>
                    {student.duplicateHold === true && (
                      <span className="badge text-bg-warning ms-2">Possible duplicate</span>
                    )}
                  </div>
                  {student.duplicateHold === true && (
                    <div className="small fw-semibold text-warning-emphasis mt-1">
                      <i className="bi bi-people me-1" aria-hidden="true" />
                      {matchedLine(student, originalOf(student))}
                    </div>
                  )}
                  <div className="small text-muted">
                    {student.class} · {student.subjects}
                  </div>
                  <div className="small text-muted">{student.parentPhone}</div>

                  {student.receiptMessage && (
                    <details className="mt-2">
                      <summary className="small text-primary" style={{ cursor: 'pointer' }}>
                        Payment message
                      </summary>
                      <p className="small bg-light p-2 rounded mt-1 mb-0">
                        {student.receiptMessage}
                      </p>
                    </details>
                  )}

                  {student.rejectionCount > 0 && (
                    <div className="small text-danger mt-1">
                      <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
                      Resubmitted after {student.rejectionCount} rejection
                      {student.rejectionCount > 1 ? 's' : ''}
                    </div>
                  )}
                </div>

                <div className="d-flex gap-2">
                  <button
                    className="btn btn-success btn-sm"
                    onClick={() => handleApprove(student)}
                    disabled={busy}
                  >
                    <i className="bi bi-check-lg me-1" aria-hidden="true" />
                    Approve
                  </button>
                  {student.duplicateHold === true ? (
                    <>
                      <button
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => setDecliningId(decliningId === student.id ? null : student.id)}
                        disabled={busy}
                      >
                        Decline as duplicate
                      </button>
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => setComparingId(comparingId === student.id ? null : student.id)}
                        disabled={busy}
                        aria-expanded={comparingId === student.id}
                      >
                        Compare
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-outline-danger btn-sm"
                      onClick={() => {
                        setRejectingPhone(student.id);
                        setReason('');
                      }}
                      disabled={busy}
                    >
                      Reject
                    </button>
                  )}
                </div>
              </div>

              {decliningId === student.id && (
                <div className="mt-3 small">
                  <p className="mb-2">
                    Remove {suffixOf(student.id)}? It will be told:
                    <span className="d-block fst-italic mt-1">“{retiredMessage('duplicate')}”</span>
                  </p>
                  <div className="d-flex gap-2">
                    <button className="btn btn-danger btn-sm" onClick={() => handleDecline(student)} disabled={busy}>
                      {`Yes, decline ${suffixOf(student.id)}`}
                    </button>
                    <button className="btn btn-outline-secondary btn-sm" onClick={() => setDecliningId(null)} disabled={busy}>
                      Back
                    </button>
                  </div>
                </div>
              )}

              {comparingId === student.id && (
                <div className="mt-3">
                  {originalOf(student) ? (
                    <Suspense fallback={<p className="small text-muted mb-0">Loading…</p>}>
                      <DuplicatePair
                        session={student.session}
                        pair={{ key: `${student.duplicateOf}|${student.id}`, a: originalOf(student), b: student, reasons: matchReasons(originalOf(student), student) }}
                        showSuccess={toast?.showSuccess}
                        showError={toast?.showError}
                      />
                    </Suspense>
                  ) : (
                    <p className="small text-muted mb-0">The other registration isn't in the lists loaded here.</p>
                  )}
                </div>
              )}

              {rejectingPhone === student.id && (
                <div className="mt-3">
                  <label className="form-label small fw-semibold" htmlFor={`reason-${student.id}`}>
                    Why are you rejecting this registration? The student will see this.
                  </label>
                  <textarea
                    id={`reason-${student.id}`}
                    className="form-control form-control-sm"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. The payment message doesn't match the amount for Grade 8."
                    maxLength={500}
                  />
                  <div className="d-flex justify-content-between align-items-center mt-2">
                    <small className={reason.trim().length < 10 ? 'text-danger' : 'text-muted'}>
                      {reason.trim().length < 10
                        ? `${10 - reason.trim().length} more character(s) needed`
                        : `${reason.length}/500`}
                    </small>
                    <div className="d-flex gap-2">
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleReject(student)}
                        disabled={busy || reason.trim().length < 10}
                      >
                        Send rejection
                      </button>
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => setRejectingPhone(null)}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </m.div>
  );
}
