import { renderTemplate } from '@utils/messageTemplate';
import {
  normalizeSmsText, unsupportedChars, smsLength, smsUnits, smsCost, smsPlainValue, SMS_MAX_CHARS,
} from '@utils/smsText';

/**
 * The composer's text — 008Fixes / 09 (owner: the `{{…}}` placeholders read
 * like "funny things"; they become plain buttons with a short guide).
 *
 * In the box a placeholder is written as its name in square brackets —
 * "[Student name]" — which a teacher can read, type, move and delete like any
 * word. Only when the message goes to the server is it turned into the token
 * the server fills in ({{studentName}}). Brackets that are not one of these
 * names are left as they are.
 */

export const PLACEHOLDERS = Object.freeze([
  { token: 'studentName', label: 'Student name' },
  { token: 'schoolName', label: 'School name' },
  { token: 'class', label: 'Class' },
  { token: 'sessionName', label: 'Session' },
  { token: 'balance', label: 'Fee balance', fees: true },
  { token: 'dueDate', label: 'Due date', fees: true },
]);

const BY_LABEL = new Map(PLACEHOLDERS.map((p) => [p.label.toLowerCase(), p.token]));
const BY_TOKEN = new Map(PLACEHOLDERS.map((p) => [p.token, p.label]));

/** "[Student name]" → "{{studentName}}" (case-insensitive); other brackets untouched. */
export function toTemplate(text) {
  return String(text ?? '').replace(/\[([^\]\n]{1,30})\]/g, (match, name) => {
    const token = BY_LABEL.get(name.trim().toLowerCase());
    return token ? `{{${token}}}` : match;
  });
}

/** "{{studentName}}" → "[Student name]" (for prepared drafts, e.g. from Recent actions). */
export function toFriendly(template) {
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, token) => {
    const label = BY_TOKEN.get(token);
    return label ? `[${label}]` : match;
  });
}

/** Starter messages (the box starts empty: fee wording only when chosen). */
export const STARTERS = Object.freeze([
  { id: 'reminder', label: 'Class reminder', text: "[School name]: Dear parent, [Student name]'s class is today at the usual time. Please make sure they join on time." },
  { id: 'fees', label: 'Fee reminder', fees: true, text: "[School name]: Dear parent, [Student name]'s fee balance is [Fee balance]. Please pay by M-Pesa and paste the message on the class page. Thank you." },
  { id: 'holiday', label: 'Holiday notice', text: '[School name]: Dear parent, there will be no class on [date]. Classes resume on [date]. Thank you.' },
]);

/** Characters the box cannot keep (emoji and others SMS can't carry), and the text without them. */
export function stripUnsupported(text) {
  const bad = unsupportedChars(text);
  if (!bad.length) return { text, removed: [] };
  const drop = new Set(bad);
  return { text: [...String(text)].filter((ch) => !drop.has(ch)).join(''), removed: bad };
}

/** One person's WhatsApp message: no SMS cleaning (WhatsApp carries every letter). */
export function renderWhatsApp(friendlyText, person, schoolName) {
  return renderTemplate(toTemplate(friendlyText), { ...person, schoolName: schoolName ?? '' }).trim();
}

/** One person's SMS, exactly as the server will fill it. */
export function renderFor(friendlyText, person, schoolName) {
  const safe = {
    ...person,
    studentName: person.studentName == null ? null : smsPlainValue(person.studentName),
    class: person.class == null ? null : smsPlainValue(person.class),
    sessionName: person.sessionName == null ? null : smsPlainValue(person.sessionName),
    schoolName: smsPlainValue(schoolName ?? ''),
  };
  return normalizeSmsText(renderTemplate(toTemplate(friendlyText), safe)).trim();
}

/**
 * The counter: every person's version, the longest one and whose, units and
 * cost. Over two SMS is `over > 0`. With nobody chosen, the text alone.
 */
export function measure(friendlyText, people, schoolName) {
  const list = people?.length ? people : [{ studentName: '', class: '', sessionName: '' }];
  let longest = null;
  let units = 0;
  for (const person of list) {
    const text = renderFor(friendlyText, person, schoolName);
    const length = smsLength(text);
    units += smsUnits(length);
    if (!longest || length > longest.length) longest = { length, studentName: person.studentName ?? null, text };
  }
  return {
    length: longest.length,
    units: smsUnits(longest.length),
    totalUnits: people?.length ? units : 0,
    cost: people?.length ? smsCost(units) : 0,
    studentName: people?.length ? longest.studentName : null,
    over: Math.max(0, longest.length - SMS_MAX_CHARS),
    sample: longest.text,
  };
}
