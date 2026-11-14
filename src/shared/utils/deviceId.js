/**
 * This browser's device id — 008Fixes / 03.
 *
 * One admission number checks in on ONE device per class (owner answer 8).
 * The server tells devices apart by this random id, sent with each check-in
 * and class-link request; it stores only a hash of it. Nothing personal: a
 * random value, made once and kept in localStorage.
 *
 * Storage can throw (private windows, a full disk — Sentry ONLINE-TUTORING-1-D)
 * or be cleared. Then the id lives for this page load only: a later visit
 * counts as a new device, and the teacher's "Allow again" covers it.
 * Matches api/_lib/checkinLock.js DEVICE_ID_PATTERN (16–64 of [A-Za-z0-9_-]).
 */

const KEY = 'ot.device.v1';
const PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
let memory = null;

function fresh() {
  const bytes = new Uint8Array(16);
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getDeviceId() {
  if (memory) return memory;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && PATTERN.test(stored)) {
      memory = stored;
      return memory;
    }
  } catch {
    // No storage: this page load only.
  }
  memory = fresh();
  try {
    localStorage.setItem(KEY, memory);
  } catch {
    // Kept in memory.
  }
  return memory;
}

/** Test hook. */
export function __resetDeviceId() {
  memory = null;
}
