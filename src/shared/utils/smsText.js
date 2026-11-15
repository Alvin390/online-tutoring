/**
 * SMS text rules — 008Fixes / 07 (owner, 2026-11-15: at most two SMS,
 * measured on the longest parent's version; emoji refused altogether).
 *
 * HashBack bills 168 plain (GSM-7) characters a unit (checked 2026-11-15:
 * 168 = 1 unit, 169 = 2, 336 = 2, 337 = 3; "é" stays plain; an emoji switches
 * the whole message to UCS2). So a message may be at most 336 characters,
 * all of them GSM-7.
 *
 * Phone keyboards type curly quotes, long dashes and "…", which are not GSM-7
 * and would silently double the cost: they are turned into their plain forms
 * first. Anything else outside GSM-7 (emoji, other scripts) is refused, and
 * the message says which character.
 *
 * PARITY: api/_lib/smsText.js is the server copy (no Vite aliases there);
 * tests/unit/fixes008/smsText.test.js keeps the two identical.
 */

export const SMS_UNIT_CHARS = 168;
export const SMS_MAX_UNITS = 2;
export const SMS_MAX_CHARS = SMS_UNIT_CHARS * SMS_MAX_UNITS; // 336
export const SMS_RATE_KES = 0.35;

// GSM 03.38 basic set and the extension table (each extension character
// is sent as two).
const GSM_BASIC = new Set([..."@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"]);
const GSM_EXTENDED = new Set([...'^{}\\[~]|€']);

const REPLACEMENTS = [
  [/[\u2018\u2019\u201A\u201B\u2032\u0060\u00B4]/g, "'"],
  [/[\u201C\u201D\u201E\u201F\u2033]/g, '"'],
  [/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-'],
  [/\u2026/g, '...'],
  [/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' '],
  [/\u200B|\u200C|\u200D|\u2060|\uFEFF/g, ''],
  [/\u2022/g, '-'],
];

/** The text as it will be sent: curly quotes, long dashes, "…" and odd spaces made plain. */
export function normalizeSmsText(text) {
  let out = String(text ?? '');
  for (const [pattern, plain] of REPLACEMENTS) out = out.replace(pattern, plain);
  return out;
}

/** Characters (after normalising) that SMS cannot carry plainly, each once, in order. */
export function unsupportedChars(text) {
  const seen = [];
  for (const ch of normalizeSmsText(text)) {
    if (!GSM_BASIC.has(ch) && !GSM_EXTENDED.has(ch) && !seen.includes(ch)) seen.push(ch);
  }
  return seen;
}

/** Length as billed: extension characters (€ [ ] { } ~ ^ | \) count twice. */
export function smsLength(text) {
  let n = 0;
  for (const ch of normalizeSmsText(text)) n += GSM_EXTENDED.has(ch) ? 2 : 1;
  return n;
}

/** Units (SMS) for that length; 0 for an empty message. */
export const smsUnits = (length) => (length > 0 ? Math.ceil(length / SMS_UNIT_CHARS) : 0);

/** KES for `units` units to `recipients` people, to the cent. */
export const smsCost = (units, recipients = 1) => Math.round(units * recipients * SMS_RATE_KES * 100) / 100;

/**
 * Why a finished message (one parent's version) cannot be sent, or null:
 * { code: 'empty' | 'unsupported' | 'too_long', message, chars?, over? }.
 */
export function smsProblem(text) {
  const plain = normalizeSmsText(text).trim();
  if (!plain) return { code: 'empty', message: 'Write a message first.' };
  const bad = unsupportedChars(plain);
  if (bad.length) {
    return {
      code: 'unsupported',
      chars: bad,
      message: `SMS can't carry ${bad.length === 1 ? 'this character' : 'these characters'}: ${bad.join(' ')}. Emoji can't be sent by SMS.`,
    };
  }
  const length = smsLength(plain);
  if (length > SMS_MAX_CHARS) {
    return {
      code: 'too_long',
      over: length - SMS_MAX_CHARS,
      message: `Too long for ${SMS_MAX_UNITS} SMS. Shorten it by ${length - SMS_MAX_CHARS} character${length - SMS_MAX_CHARS === 1 ? '' : 's'}.`,
    };
  }
  return null;
}
