import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFlag } from '@shared/config/FlagsContext';
import TierGate from '@shared/components/TierGate';

// Lazy: the notes tab carries a composer and tag UI the dashboard should not
// pay for on first paint, and most dashboard sessions never open it.
const NotesTab = lazy(() => import('@features/notes/components/NotesTab'));
const FeesTab = lazy(() => import('@features/fees/components/FeesTab'));

/**
 * Student detail drawer — Phase 05 Part B.
 *
 * A right-side drawer rather than a fourth modal. `StudentTable` already stacks
 * three (delete, edit, block); adding another compounds a problem rather than
 * solving one, and tabs give Phases 06 and 10 somewhere to put fees and
 * activity without another round of this.
 *
 * Accessibility, because a drawer that traps focus badly is worse than a modal:
 *   - role="dialog" + aria-modal + a labelled heading
 *   - focus moves in on open and returns to the trigger on close
 *   - Tab cycles within the drawer; Escape closes
 *   - body scroll locked while open
 */

const TABS = [
  { id: 'details', label: 'Details', icon: 'bi-person' },
  { id: 'notes', label: 'Notes', icon: 'bi-journal-text', flag: 'notes.enabled' },
  { id: 'fees', label: 'Fees', icon: 'bi-cash-coin', flag: 'fees.enabled' },
];

export default function StudentDrawer({ open, student, session, onClose }) {
  const [tab, setTab] = useState('details');
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);

  const notesEnabled = useFlag('notes.enabled');
  const feesEnabled = useFlag('fees.enabled');
  const flagState = { 'notes.enabled': notesEnabled, 'fees.enabled': feesEnabled };
  const visibleTabs = TABS.filter((t) => !t.flag || flagState[t.flag]);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the panel itself rather than the first control: a drawer that jumps
    // straight into a textarea reads as an input prompt, not a panel.
    panelRef.current?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusables = panelRef.current.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  // Reset to the first tab whenever a different student is opened.
  useEffect(() => {
    setTab('details');
  }, [student?.id]);

  if (!student) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="position-fixed top-0 start-0 w-100 h-100"
            style={{ background: 'rgba(0,0,0,0.4)', zIndex: 1045 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
            className="position-fixed top-0 end-0 h-100 bg-white shadow-lg d-flex flex-column"
            style={{ width: 'min(460px, 100vw)', zIndex: 1050, outline: 'none' }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.2 }}
          >
            <div className="d-flex justify-content-between align-items-start p-3 border-bottom">
              <div>
                <h2 id="drawer-title" className="h5 fw-bold mb-0">
                  {student.studentName ?? 'Student'}
                </h2>
                <small className="text-muted">
                  {student.class} · <span className="text-capitalize">{session}</span>
                </small>
              </div>
              <button
                type="button"
                className="btn-close"
                onClick={onClose}
                aria-label="Close student details"
              />
            </div>

            {visibleTabs.length > 1 && (
              <ul className="nav nav-tabs px-3 pt-2" role="tablist">
                {visibleTabs.map((t) => (
                  <li className="nav-item" key={t.id} role="presentation">
                    <button
                      className={`nav-link ${tab === t.id ? 'active' : ''}`}
                      onClick={() => setTab(t.id)}
                      role="tab"
                      aria-selected={tab === t.id}
                      aria-controls={`panel-${t.id}`}
                      id={`tab-${t.id}`}
                    >
                      <i className={`bi ${t.icon} me-1`} aria-hidden="true" />
                      {t.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex-grow-1 overflow-auto p-3">
              {tab === 'details' && (
                <div id="panel-details" role="tabpanel" aria-labelledby="tab-details">
                  <dl className="row mb-0 small">
                    <dt className="col-5 text-muted fw-normal">Parent phone</dt>
                    <dd className="col-7">{student.parentPhone ?? '—'}</dd>

                    <dt className="col-5 text-muted fw-normal">Subjects</dt>
                    <dd className="col-7">{student.subjects ?? '—'}</dd>

                    <dt className="col-5 text-muted fw-normal">Approval</dt>
                    <dd className="col-7 text-capitalize">
                      {student.approvalStatus ?? 'approved'}
                    </dd>

                    <dt className="col-5 text-muted fw-normal">Access</dt>
                    <dd className="col-7">
                      {student.blocked === true ? (
                        <span className="text-danger">
                          <i className="bi bi-lock-fill me-1" aria-hidden="true" />
                          Blocked
                        </span>
                      ) : (
                        <span className="text-success">
                          <i className="bi bi-unlock-fill me-1" aria-hidden="true" />
                          Active
                        </span>
                      )}
                    </dd>

                    {student.blocked === true && student.blockReason && (
                      <>
                        <dt className="col-5 text-muted fw-normal">Reason</dt>
                        <dd className="col-7">{student.blockReason}</dd>
                      </>
                    )}

                    <dt className="col-5 text-muted fw-normal">Receipt</dt>
                    <dd className="col-7 text-capitalize">{student.receiptStatus ?? '—'}</dd>
                  </dl>

                  {student.receiptMessage && (
                    <div className="mt-3">
                      <div className="text-muted small mb-1">Payment message</div>
                      <p className="small bg-light p-2 rounded mb-0" style={{ whiteSpace: 'pre-wrap' }}>
                        {student.receiptMessage}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {tab === 'notes' && notesEnabled && (
                <div id="panel-notes" role="tabpanel" aria-labelledby="tab-notes">
                  <Suspense
                    fallback={
                      <div className="text-center py-4">
                        <span className="spinner-border spinner-border-sm text-muted" />
                      </div>
                    }
                  >
                    <NotesTab
                      session={session}
                      phone={student.id ?? student.parentPhone}
                      studentName={student.studentName}
                      active={tab === 'notes'}
                    />
                  </Suspense>
                </div>
              )}

              {tab === 'fees' && feesEnabled && (
                <div id="panel-fees" role="tabpanel" aria-labelledby="tab-fees">
                  {/* Silver, same as the dashboard's fee panel. This one is easy
                      to miss: the tab is reachable per-student even when the
                      dashboard KPI card above is gated, so without this a Bronze
                      teacher still walks into a 403 from api/fees/post.js. */}
                  <TierGate
                    tier="silver"
                    feature="Fee ledger"
                    description="Record payments and see this student's balance"
                  >
                    <Suspense
                      fallback={
                        <div className="text-center py-4">
                          <span className="spinner-border spinner-border-sm text-muted" />
                        </div>
                      }
                    >
                      <FeesTab
                        session={session}
                        phone={student.id ?? student.parentPhone}
                        active={tab === 'fees'}
                      />
                    </Suspense>
                  </TierGate>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
