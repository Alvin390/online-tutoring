/**
 * WhatsApp click-to-chat links — Phase 08 D5.
 *
 * TWO PROPERTIES OF `wa.me` ARE ABSOLUTE AND CANNOT BE ENGINEERED AROUND.
 * They are restated here so the design is not relitigated later:
 *
 *   1. `wa.me/<number>?text=<encoded>` PRE-FILLS TEXT ONLY. A file can never be
 *      pre-attached. There is no parameter, no API and no trick. Attachments in
 *      WhatsApp are always chosen by the human in the WhatsApp client.
 *      → Therefore documents go to Storage and the LINK goes in the text.
 *
 *   2. OPENING MANY WINDOWS AT ONCE IS BLOCKED. Browsers permit one
 *      `window.open` per user gesture; a loop over 40 recipients opens the
 *      first and silently drops the rest.
 *      → Therefore sending is a resumable one-at-a-time queue driven by real
 *        anchor clicks.
 *
 * The number format is likewise fixed: digits only, no `+`, no spaces, no
 * dashes. `wa.me/+254712345678` does not work.
 */

const WA_BASE = 'https://wa.me';

/** WhatsApp's practical message ceiling. */
export const MAX_MESSAGE_LENGTH = 4096;

/**
 * Normalises a stored E.164 number to the digits-only form `wa.me` needs.
 *
 * @returns {{valid: true, digits: string} | {valid: false, error: string}}
 */
export function toWaNumber(phone) {
  if (typeof phone !== 'string' && typeof phone !== 'number') {
    return { valid: false, error: 'No phone number on record' };
  }

  const digits = String(phone).replace(/[^\d]/g, '');

  if (digits.length === 0) return { valid: false, error: 'No phone number on record' };

  // E.164 allows 8–15 digits including the country code. Anything shorter is a
  // local number stored without one, which wa.me silently fails on rather than
  // erroring — so it is caught here instead.
  if (digits.length < 8) {
    return { valid: false, error: 'Number is too short — is the country code missing?' };
  }
  if (digits.length > 15) {
    return { valid: false, error: 'Number is too long to be valid' };
  }
  // A leading zero means a local number that was never internationalised.
  if (digits.startsWith('0')) {
    return { valid: false, error: 'Number starts with 0 — it needs a country code' };
  }

  return { valid: true, digits };
}

/**
 * Builds the click-to-chat URL.
 *
 * The message is encoded with `encodeURIComponent`, which is what makes
 * newlines, ampersands and emoji survive the round trip. Building this by hand
 * is how messages get truncated at the first `&`.
 */
export function buildWaLink(phone, message) {
  const number = toWaNumber(phone);
  if (!number.valid) return { valid: false, error: number.error };

  const text = String(message ?? '');
  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      valid: false,
      error: `Message is ${text.length} characters; WhatsApp's limit is ${MAX_MESSAGE_LENGTH}`,
    };
  }

  const url = text
    ? `${WA_BASE}/${number.digits}?text=${encodeURIComponent(text)}`
    : `${WA_BASE}/${number.digits}`;

  return { valid: true, url, digits: number.digits };
}

/**
 * Masks a number for display in the queue.
 *
 * The teacher needs enough to recognise who is next without the screen becoming
 * a roster of parent phone numbers that anyone walking past can read.
 */
export function maskForDisplay(phone) {
  const digits = String(phone ?? '').replace(/[^\d]/g, '');
  if (digits.length < 6) return '•••';
  return `+${digits.slice(0, 3)} ${digits.slice(3, 4)}•• ••• ${digits.slice(-3)}`;
}

/**
 * Pre-flight check over a recipient list.
 *
 * Invalid numbers are surfaced BEFORE the queue starts, not discovered one at a
 * time mid-send. A teacher three-quarters through a 40-person broadcast should
 * not be meeting their data-entry mistakes for the first time.
 */
export function preflight(recipients) {
  const sendable = [];
  const problems = [];

  for (const recipient of recipients ?? []) {
    if (recipient.whatsappOptOut === true) {
      problems.push({ ...recipient, reason: 'opted_out', message: 'Has opted out of messages' });
      continue;
    }

    const number = toWaNumber(recipient.phone ?? recipient.parentPhone ?? recipient.id);
    if (!number.valid) {
      problems.push({ ...recipient, reason: 'invalid_number', message: number.error });
      continue;
    }

    sendable.push({ ...recipient, digits: number.digits });
  }

  return { sendable, problems };
}

/**
 * Honest time estimate, shown before the queue starts.
 *
 * A teacher who knows a 34-student broadcast takes about three minutes is not
 * frustrated by it. One who expected it to be instant is.
 */
export function estimateDuration(count, secondsEach = 4) {
  const totalSeconds = count * secondsEach;
  if (totalSeconds < 60) return `about ${totalSeconds} seconds`;
  const minutes = Math.round(totalSeconds / 60);
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export { WA_BASE };
