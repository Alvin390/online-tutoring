import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import Toast from '@components/ui/Toast';

/**
 * Toasts — rebuilt in Phase 13 / 07 D2.
 *
 * What was wrong:
 *   - Styled with Tailwind classes this project does not load, so toasts were
 *     unstyled text dumped wherever the page flow put them (B-toast).
 *   - `id = Date.now()`: two toasts in the same millisecond shared a React key
 *     and a timer, so dismissing one dismissed both (S-toast-id).
 *   - The context value was a fresh object on every render, so every one of
 *     the ~30 components calling useToast() re-rendered on every toast.
 *
 * Now: Bootstrap toast styles; UUID ids; at most 4 visible (oldest drops);
 * timers live in each Toast and pause on hover/focus; and the context holds
 * ONLY the stable actions — the list is rendered here and reaches nobody else.
 */

const ToastContext = createContext(null);

export const MAX_TOASTS = 4;

let fallbackSeq = 0;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `toast-${Date.now()}-${(fallbackSeq += 1)}`;

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * @param {'success'|'error'|'warning'|'info'} type
   * @param {{duration?: number, action?: {label: string, onClick: () => void}}} [options]
   *        `action` adds a button (e.g. "Undo"); clicking it also dismisses.
   */
  const showToast = useCallback((type, title, message, duration = 5000, options = {}) => {
    const id = newId();
    setToasts((prev) => [...prev, { id, type, title, message, duration, action: options.action ?? null }].slice(-MAX_TOASTS));
    return id;
  }, []);

  const actions = useMemo(() => {
    const make = (type, fallbackTitle) => (message, title = fallbackTitle, options = {}) =>
      showToast(type, title, message, options.duration ?? 5000, options);
    return {
      showToast,
      showSuccess: make('success', 'Success'),
      showError: make('error', 'Error'),
      showWarning: make('warning', 'Warning'),
      showInfo: make('info', 'Info'),
      dismissToast: removeToast,
    };
  }, [showToast, removeToast]);

  return (
    <ToastContext.Provider value={actions}>
      {children}
      <div className="toast-container" data-testid="toast-container">
        <AnimatePresence>
          {toasts.map((toast) => (
            <Toast key={toast.id} {...toast} onClose={() => removeToast(toast.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

/**
 * 003Fixes / 05: the toast actions, or null outside a ToastProvider — for
 * components (the student list) also rendered on their own, e.g. in tests.
 */
export const useOptionalToast = () => useContext(ToastContext);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};
