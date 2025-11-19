import { motion } from 'framer-motion';

const Toast = ({ id, type, title, message, onClose }) => {
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  const colors = {
    success: 'border-green-500 bg-green-50',
    error: 'border-red-500 bg-red-50',
    warning: 'border-yellow-500 bg-yellow-50',
    info: 'border-blue-500 bg-blue-50'
  };

  const iconColors = {
    success: 'text-green-500',
    error: 'text-red-500',
    warning: 'text-yellow-500',
    info: 'text-blue-500'
  };

  const textColors = {
    success: 'text-green-800',
    error: 'text-red-800',
    warning: 'text-yellow-800',
    info: 'text-blue-800'
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
      className={`flex items-center gap-3 p-4 rounded-lg shadow-lg border-l-4 ${colors[type]} mb-2`}
    >
      <div className={`text-2xl font-bold ${iconColors[type]}`}>
        {icons[type]}
      </div>
      <div className="flex-1">
        <div className={`font-bold text-sm ${textColors[type]}`}>{title}</div>
        <div className={`text-sm ${textColors[type]} opacity-90`}>{message}</div>
      </div>
      <button
        onClick={onClose}
        className={`text-2xl ${iconColors[type]} opacity-60 hover:opacity-100 transition-opacity`}
      >
        ×
      </button>
    </motion.div>
  );
};

export default Toast;
