import { useState, useEffect, useCallback } from 'react';

/**
 * How long a refused student must wait — 002Fixes / 05.
 *
 * On 26 Oct three students were told "Too many requests. Please wait a moment"
 * and then refused for up to an hour. The server already says how long, in
 * Retry-After (phase 01 carries it on the error as `retryAfter`); this keeps
 * that deadline, counts it down, and survives a reload — a reload that reset
 * the countdown would just earn another refusal.
 *
 * Kept per class page in sessionStorage, keyed WITHOUT the phone number.
 */

const DEFAULT_WAIT_SECONDS = 60;
const key = (session) => `checkinWait:${session}`;

function readSaved(session) {
  try {
    const until = Number(sessionStorage.getItem(key(session)));
    return until > Date.now() ? until : 0;
  } catch {
    return 0; // storage unavailable: the wait simply does not survive a reload
  }
}

/** Whole seconds until `until` (a ms timestamp), re-rendering each second; 0 when past. */
export function useSecondsLeft(until) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!until || until <= Date.now()) return undefined;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      if (Date.now() >= until) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
}

export function useRetryWait(session) {
  const [until, setUntil] = useState(() => readSaved(session));
  const secondsLeft = useSecondsLeft(until);

  /** Start (or extend) the wait from a refusal's Retry-After, in seconds. */
  const startWait = useCallback((seconds) => {
    const ms = Date.now() + Math.max(1, Number(seconds) || DEFAULT_WAIT_SECONDS) * 1000;
    setUntil(ms);
    try { sessionStorage.setItem(key(session), String(ms)); } catch { /* storage unavailable */ }
  }, [session]);

  return { until, secondsLeft, startWait };
}
