import { useSyncExternalStore } from 'react';

/**
 * A WhatsApp message prepared elsewhere on the dashboard — 003Fixes / 09.
 * Recent actions sets it ("Message these parents"); the dashboard hands it
 * to the WhatsApp panel, which opens with the recipients and a draft filled
 * in. Nothing is sent: the teacher reviews and sends as usual.
 */
let state = { preset: null, version: 0 };
const listeners = new Set();

export function setWhatsappPreset(preset) {
  state = { preset, version: state.version + 1 };
  listeners.forEach((fn) => fn());
}

export function useWhatsappPreset() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => state
  );
}

/** The draft offered for parents of blocked students (editable before sending). */
export function blockedParentsDraft({ kind }) {
  return kind === 'fees'
    ? 'Dear parent, {{studentName}}’s access to {{sessionName}} is paused until the fee of {{balance}} is paid. Please send the M-Pesa payment and paste the confirmation message on the class page to rejoin. Thank you.'
    : 'Dear parent, {{studentName}}’s access to {{sessionName}} is paused until next week’s fee is paid. Please send the M-Pesa payment and paste the confirmation message on the class page to rejoin. Thank you.';
}
