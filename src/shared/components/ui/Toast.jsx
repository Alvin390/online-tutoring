import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

/**
 * One toast — Phase 13 / 07 D2. Bootstrap's `.toast` styles (Tailwind is not
 * loaded in this project, which is why toasts used to render unstyled).
 *
 * The auto-dismiss timer pauses while the pointer is over the toast or focus
 * is inside it, so nobody loses a message (or an Undo) mid-read.
 * Errors are `role="alert"` (interrupting); everything else is a polite status.
 */

const VARIANT = {
  success: { bg: 'text-bg-success', icon: 'bi-check-circle-fill', light: true },
  error: { bg: 'text-bg-danger', icon: 'bi-x-octagon-fill', light: true },
  warning: { bg: 'text-bg-warning', icon: 'bi-exclamation-triangle-fill', light: false },
  info: { bg: 'text-bg-primary', icon: 'bi-info-circle-fill', light: true },
};

const Toast = ({ type = 'info', title, message, duration = 5000, action, onClose }) => {
  const variant = VARIANT[type] ?? VARIANT.info;
  const reduceMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);
  const startedAt = useRef(0);

  useEffect(() => {
    if (paused || !(duration > 0)) return undefined;
    startedAt.current = Date.now();
    const timer = setTimeout(onClose, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
    // onClose is a fresh closure each render; the timer must not restart for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, duration]);

  const pause = () => setPaused(true);
  const resume = (event) => {
    // Leaving with focus still inside keeps it paused, and vice versa.
    if (event?.currentTarget?.contains?.(document.activeElement) && event.type === 'mouseleave') return;
    setPaused(false);
  };

  return (
    <motion.div
      layout={!reduceMotion}
      initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
      transition={{ duration: reduceMotion ? 0 : 0.18 }}
      className={`toast show border-0 ${variant.bg}`}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      data-testid="toast"
    >
      <div className="d-flex align-items-start">
        <div className="toast-body d-flex gap-2 flex-grow-1">
          <i className={`bi ${variant.icon} flex-shrink-0`} aria-hidden="true" />
          <div style={{ minWidth: 0 }}>
            {title && <div className="fw-semibold">{title}</div>}
            {message && <div className="small">{message}</div>}
            {action && (
              <button
                type="button"
                className={`btn btn-sm mt-2 ${variant.light ? 'btn-light' : 'btn-dark'}`}
                onClick={() => {
                  action.onClick();
                  onClose();
                }}
              >
                {action.label}
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          className={`btn-close me-2 mt-2 flex-shrink-0${variant.light ? ' btn-close-white' : ''}`}
          onClick={onClose}
          aria-label={`Dismiss ${title ?? 'notification'}`}
        />
      </div>
    </motion.div>
  );
};

export default Toast;
