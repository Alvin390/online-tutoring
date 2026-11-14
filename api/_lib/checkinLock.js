import { sha256 } from './crypto.js';
import { nextClassWindow } from './classTime.js';

/**
 * One device per class — 008Fixes / 03 (owner answers 8 and 9).
 *
 * The first device to check in with an admission number holds it until that
 * day's class ends (midnight in Nairobi when no class time is set, or when
 * today's class is already over). The same device checks in again freely;
 * another device is refused until then, or until the teacher presses
 * "Allow again" (which deletes the lock). The class link checks the same
 * lock, so a refused device can't fetch the link by another route.
 *
 * The lock lives in `sessions/{s}/students/{phone}/meta/checkinLock`, NOT on
 * the student record: every open dashboard listens to the records, and a lock
 * written there would push every check-in to every dashboard (the reason the
 * heartbeat moved to meta/activity, Phase 13 / 08 B3). Server-only (rules).
 *
 * The device id is a random value the page keeps in the browser; only its
 * hash, salted with the session and number, is stored.
 */

const DAY_MS = 86_400_000;
// Kenya keeps UTC+3 all year (no daylight saving); sessions are in Africa/Nairobi.
const NAIROBI_OFFSET_MS = 3 * 3_600_000;

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export const lockRef = (db, session, phone) => db.doc(`sessions/${session}/students/${phone}/meta/checkinLock`);

export const deviceHash = (session, phone, deviceId) => sha256(`${session}:${phone}:${deviceId}`);

/** The next midnight in Nairobi after `now`, in ms. */
export function nextMidnightNairobi(now = Date.now()) {
  return Math.floor((now + NAIROBI_OFFSET_MS) / DAY_MS) * DAY_MS + DAY_MS - NAIROBI_OFFSET_MS;
}

/**
 * Until when a check-in now holds the lock: the end of the class running now
 * or starting later today; otherwise the coming midnight.
 */
export function lockUntil(schedule, now = Date.now()) {
  const midnight = nextMidnightNairobi(now);
  const window = nextClassWindow(schedule, now);
  if (window && window.start < midnight && window.end > now) return window.end;
  return midnight;
}

/** 'none' | 'expired' | 'same' | 'other' for this device and the stored lock. */
export function lockState(lockData, hash, now = Date.now()) {
  if (!lockData) return 'none';
  const until = lockData.until?.toMillis?.() ?? 0;
  if (!(until > now)) return 'expired';
  return lockData.deviceHash === hash ? 'same' : 'other';
}
