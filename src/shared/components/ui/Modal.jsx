import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';

/**
 * Modal — accessibility rebuilt in Phase 10 D6.
 *
 * This component was inaccessible. It had NONE of `role="dialog"`,
 * `aria-modal`, a labelled title, a focus trap, focus restore, or an Escape
 * handler — only a body scroll lock — and the close button was a bare `×` with
 * no accessible name, which a screen reader announces as "multiplication sign".
 *
 * All of it is here now. A keyboard user can open, operate and dismiss this
 * without a mouse, and focus returns to whatever opened it.
 *
 * The drawer and the calendar event form were built with the same treatment
 * from the start, so this brings the oldest component up to the standard the
 * newer ones already meet.
 */
export default function Modal({
  title,
  children,
  onClose,
  onConfirm,
  loading,
  type = 'primary',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);
  const titleId = useId();

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    document.body.style.overflow = 'hidden';

    // Focus the dialog itself rather than the first control: landing directly
    // on "Confirm" invites someone to press Enter on a destructive action
    // before the title has been read.
    dialogRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // The trap. Without it, Tab walks out of the dialog into the page behind
      // it, which is still visible but not operable.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = 'unset';
      // Focus restore. Losing focus to <body> on close strands a keyboard user
      // at the top of the document.
      previouslyFocused.current?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="modal-overlay"
        onClick={onClose}
      >
        <motion.div
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="modal-container"
          onClick={(e) => e.stopPropagation()}
          style={{ outline: 'none' }}
        >
          <div className="modal-header">
            <h2 id={titleId} className="modal-title h5 mb-0">{title}</h2>
            <button
              className="modal-close"
              onClick={onClose}
              // Was a bare × with no accessible name.
              aria-label={`Close ${title ?? 'dialog'}`}
              type="button"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

          <div className="modal-body">{children}</div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={onClose}
              disabled={loading}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`btn btn-${type}`}
              onClick={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
              ) : null}
              {confirmLabel}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
