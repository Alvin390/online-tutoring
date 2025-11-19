import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({
  title,
  children,
  onClose,
  onConfirm,
  loading,
  type = 'primary',
}) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

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
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="modal-container"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h5 className="modal-title">{title}</h5>
            <button className="modal-close" onClick={onClose}>
              ×
            </button>
          </div>

          <div className="modal-body">{children}</div>

          <div className="modal-footer">
            <button
              className="btn btn-outline-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className={`btn btn-${type}`}
              onClick={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <span className="spinner-border spinner-border-sm me-2" />
              ) : null}
              Confirm
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
