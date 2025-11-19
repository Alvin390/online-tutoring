const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[import.meta.env.VITE_LOG_LEVEL || 'info'];

const formatMessage = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
};

const shouldLog = (level) => {
  return LOG_LEVELS[level] >= currentLevel;
};

export const logDebug = (message, meta) => {
  if (shouldLog('debug')) {
    console.debug(formatMessage('debug', message, meta));
  }
};

export const logInfo = (message, meta) => {
  if (shouldLog('info')) {
    console.info(formatMessage('info', message, meta));
  }
};

export const logWarn = (message, meta) => {
  if (shouldLog('warn')) {
    console.warn(formatMessage('warn', message, meta));
  }
};

export const logError = (message, error, meta) => {
  if (shouldLog('error')) {
    const errorMeta = {
      ...meta,
      error: error?.message || error,
      stack: error?.stack
    };
    console.error(formatMessage('error', message, errorMeta));
  }

  // Send to Sentry in production if configured
  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
    try {
      // Sentry will be initialized in Phase 6 when we set up error boundaries
      // For now, just log to console
      console.log('Sentry would capture this error in production');
    } catch (err) {
      console.warn('Failed to send error to Sentry:', err);
    }
  }
};

// Download logs functionality (from original logger.js)
const logBuffer = [];
const MAX_BUFFER = 2000;

export const addToBuffer = (level, message, meta) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    meta
  };

  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER) {
    logBuffer.shift();
  }
};

export const getLogBuffer = () => {
  return [...logBuffer];
};

export const clearLogBuffer = () => {
  logBuffer.length = 0;
};

export const downloadLogs = (filename = `client-logs-${new Date().toISOString()}.json`) => {
  try {
    const data = JSON.stringify(logBuffer, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Failed to download logs', err);
    return false;
  }
};

// Enhanced logger that also adds to buffer
const createLogger = (level) => (message, meta) => {
  addToBuffer(level, message, meta);

  switch (level) {
    case 'debug':
      logDebug(message, meta);
      break;
    case 'info':
      logInfo(message, meta);
      break;
    case 'warn':
      logWarn(message, meta);
      break;
    case 'error':
      logError(message, meta?.error, meta);
      break;
  }
};

export default {
  debug: createLogger('debug'),
  info: createLogger('info'),
  warn: createLogger('warn'),
  error: createLogger('error'),
  downloadLogs,
  getBuffer: getLogBuffer,
  clearBuffer: clearLogBuffer,
};
