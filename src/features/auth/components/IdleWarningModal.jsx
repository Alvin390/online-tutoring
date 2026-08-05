import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Inactivity warning — Phase 02 D3.
 *
 * Appears two minutes before an idle session is signed out. Accessible by
 * construction, because it steals focus and must give it back:
 *   - role="alertdialog" + aria-modal, so assistive tech announces it as an
 *     interruption rather than as page content
 *   - focus moves to the primary action on open and returns to the previously
 *     focused element on close
 *   - Escape dismisses (treated as "I'm still here")
 *   - the countdown is announced coarsely, not once per second
 */
export default function IdleWarningModal({ open, msRemaining, onStaySignedIn, onSignOut }) {
  const primaryRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;
    primaryRef.current?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onStaySignedIn();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onStaySignedIn]);

  const seconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="modal-backdrop show"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            style={{ zIndex: 1050 }}
          />
          <div
            className="modal d-block"
            style={{ zIndex: 1055 }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="idle-title"
            aria-describedby="idle-desc"
          >
            <div className="modal-dialog modal-dialog-centered modal-sm">
              <motion.div
                className="modal-content"
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <div className="modal-body text-center p-4">
                  <i
                    className="bi bi-clock-history mb-3 d-block"
                    style={{ fontSize: '2.5rem', color: '#764ba2' }}
                    aria-hidden="true"
                  />
                  <h5 id="idle-title" className="fw-bold">Still there?</h5>
                  <p id="idle-desc" className="text-muted mb-3">
                    You&apos;ll be signed out automatically to keep student data safe.
                  </p>

                  <div
                    className="fs-3 fw-bold font-monospace mb-3"
                    // Coarse announcement only. aria-live on a per-second
                    // counter would spam a screen reader continuously.
                    aria-hidden="true"
                  >
                    {mm}:{ss}
                  </div>
                  <span className="visually-hidden" aria-live="polite">
                    {seconds > 30
                      ? 'About a minute remaining before automatic sign out.'
                      : 'Less than 30 seconds remaining before automatic sign out.'}
                  </span>

                  <div className="d-grid gap-2">
                    <button
                      ref={primaryRef}
                      type="button"
                      className="btn btn-primary"
                      onClick={onStaySignedIn}
                    >
                      I&apos;m still here
                    </button>
                    <button type="button" className="btn btn-outline-secondary" onClick={onSignOut}>
                      Sign out now
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
