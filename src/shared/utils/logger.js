import { redact, redactString } from './redact';

/**
 * Application logger — Phase 01 D3.
 *
 * Every message and every metadata object is redacted before it reaches any
 * sink (console, in-memory buffer, downloaded log file). Nothing in the app
 * should call `console.*` directly; this module is the only sanctioned path.
 *
 * Two behavioural rules:
 *   - debug/info never reach the console in a production build. They are still
 *     recorded in the buffer, so `downloadLogs()` remains useful for support.
 *   - warn/error always reach the console, redacted.
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[import.meta.env.VITE_LOG_LEVEL] ?? LOG_LEVELS.info;

/**
 * True in dev, in test, and in preview builds; false only in a production
 * build. Gating on PROD rather than DEV keeps the test environment honest —
 * tests exercise the same console paths a developer sees.
 */
const consoleAllowedForVerbose = !import.meta.env.PROD;

const formatMessage = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  let metaStr = '';
  if (meta !== undefined && meta !== null) {
    try {
      metaStr = ` ${JSON.stringify(meta)}`;
    } catch {
      metaStr = ' [unserializable meta]';
    }
  }
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
};

const shouldLog = (level) => LOG_LEVELS[level] >= currentLevel;

export const logDebug = (message, meta) => {
  if (shouldLog('debug') && consoleAllowedForVerbose) {
    console.debug(formatMessage('debug', redactString(message), redact(meta)));
  }
};

export const logInfo = (message, meta) => {
  if (shouldLog('info') && consoleAllowedForVerbose) {
    console.info(formatMessage('info', redactString(message), redact(meta)));
  }
};

export const logWarn = (message, meta) => {
  if (shouldLog('warn')) {
    console.warn(formatMessage('warn', redactString(message), redact(meta)));
  }
};

export const logError = (message, error, meta) => {
  if (shouldLog('error')) {
    const errorMeta = redact({
      ...(typeof meta === 'object' && meta !== null && !(meta instanceof Error) ? meta : {}),
      error: error?.message ?? error,
      code: error?.code,
      stack: error?.stack,
    });
    console.error(formatMessage('error', redactString(message), errorMeta));
  }
};

// ---------------------------------------------------------------------------
// In-memory buffer, for support downloads. Redacted on the way in, so a
// downloaded log file is safe to email.
// ---------------------------------------------------------------------------

const logBuffer = [];
const MAX_BUFFER = 2000;

export const addToBuffer = (level, message, meta) => {
  logBuffer.push({
    timestamp: new Date().toISOString(),
    level,
    message: redactString(message),
    meta: redact(meta),
  });

  if (logBuffer.length > MAX_BUFFER) {
    logBuffer.shift();
  }
};

export const getLogBuffer = () => [...logBuffer];

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
    logError('Failed to download logs', err);
    return false;
  }
};

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
    case 'error': {
      // Accept both shapes that exist in the codebase:
      //   logger.error('msg', errorInstance)
      //   logger.error('msg', { error, ...context })
      const error = meta instanceof Error ? meta : meta?.error;
      logError(message, error, meta);
      break;
    }
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
