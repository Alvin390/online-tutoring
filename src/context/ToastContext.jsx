import { createContext, useContext, useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import Toast from '@components/ui/Toast';

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((type, title, message, duration = 5000) => {
    const id = Date.now();
    const toast = { id, type, title, message, duration };

    setToasts(prev => [...prev, toast]);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const showSuccess = useCallback((message, title = 'Success') => {
    showToast('success', title, message);
  }, [showToast]);

  const showError = useCallback((message, title = 'Error') => {
    showToast('error', title, message);
  }, [showToast]);

  const showWarning = useCallback((message, title = 'Warning') => {
    showToast('warning', title, message);
  }, [showToast]);

  const showInfo = useCallback((message, title = 'Info') => {
    showToast('info', title, message);
  }, [showToast]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const value = {
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-50 max-w-md w-full px-4">
        <AnimatePresence>
          {toasts.map(toast => (
            <Toast
              key={toast.id}
              {...toast}
              onClose={() => removeToast(toast.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};
