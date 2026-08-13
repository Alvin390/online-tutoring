import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Inactive session timeout — Phase 02 D3.
 *
 * Signs the teacher out after a period of no interaction, with a warning first
 * so nobody loses work mid-sentence. The dashboard shows every student's name,
 * parent phone and payment history; an unattended logged-in session on a shared
 * or stolen laptop is a data-protection problem, not just a hygiene one.
 *
 * Implementation notes:
 *   - Two timers (warn, then expire) rather than one polled interval, so an
 *     idle tab costs nothing.
 *   - Activity listeners are passive and throttled to at most one reset per
 *     second; without that, a handler resetting two timers on every scroll
 *     event thrashes.
 *   - Once the warning is showing, only an explicit reset dismisses it. A stray
 *     mouse event should not silently extend a session the user has walked away
 *     from — that would defeat the point.
 */

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'visibilitychange'];
const RESET_THROTTLE_MS = 1000;

export function useIdleTimeout({
  timeoutMs = 12 * 60 * 60 * 1000, // 12 hours
  warningMs = 2 * 60 * 1000, //  2 minutes before expiry
  onTimeout,
  enabled = true,
} = {}) {
  const [warning, setWarning] = useState(false);
  const [msRemaining, setMsRemaining] = useState(warningMs);

  const warnTimer = useRef(null);
  const expireTimer = useRef(null);
  const countdown = useRef(null);
  const lastReset = useRef(0);
  const onTimeoutRef = useRef(onTimeout);

  // Held in a ref so a caller passing an inline arrow does not restart the
  // timers on every render.
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const clearAll = useCallback(() => {
    clearTimeout(warnTimer.current);
    clearTimeout(expireTimer.current);
    clearInterval(countdown.current);
  }, []);

  const start = useCallback(() => {
    clearAll();
    setWarning(false);

    warnTimer.current = setTimeout(() => {
      setWarning(true);
      setMsRemaining(warningMs);

      countdown.current = setInterval(() => {
        setMsRemaining((prev) => Math.max(0, prev - 1000));
      }, 1000);
    }, Math.max(0, timeoutMs - warningMs));

    expireTimer.current = setTimeout(() => {
      clearAll();
      setWarning(false);
      onTimeoutRef.current?.();
    }, timeoutMs);
  }, [timeoutMs, warningMs, clearAll]);

  /** Called by the "I'm still here" button. */
  const reset = useCallback(() => {
    lastReset.current = Date.now();
    start();
  }, [start]);

  useEffect(() => {
    if (!enabled) {
      clearAll();
      return undefined;
    }

    start();

    const onActivity = () => {
      if (warning) return;
      const now = Date.now();
      if (now - lastReset.current < RESET_THROTTLE_MS) return;
      lastReset.current = now;
      start();
    };

    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, onActivity, { passive: true })
    );

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
      clearAll();
    };
  }, [enabled, warning, start, clearAll]);

  return { warning, msRemaining, reset };
}

export default useIdleTimeout;
