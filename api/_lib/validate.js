import { z } from 'zod';
import { badRequest } from './errors.js';
import { SLUG_PATTERN, RESERVED_SLUGS } from './sessions.js';

/**
 * Zod schema runner — Phase 01 D4.
 *
 * Validation is a whitelist, never a blacklist: every schema here is `.strict()`
 * so an unexpected key is a rejection rather than a silently ignored field.
 * That is what closes mass assignment — the classic version of which in a
 * billing system is a client posting its own `amount`.
 */

export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.join('.') || 'body';
    const err = badRequest(`${path}: ${first?.message ?? 'invalid value'}`, 'validation_failed');
    // For the server log only (sendError); the response body is unchanged.
    err.detail = { field: path, issue: first?.code ?? 'unknown', ...valueShape(valueAt(data, first?.path)) };
    throw err;
  }
  return result.data;
}

function valueAt(data, path = []) {
  return path.reduce((node, key) => (node == null ? undefined : node[key]), data);
}

/**
 * The SHAPE of a rejected value, never the value — 002Fixes / 02.
 *
 * On 26 Oct an empty phone was only found because Cloudflare happened to log
 * the request's size. These fields say what was wrong with any field, for any
 * reason, without the value itself ever reaching a log: a kind, a length,
 * whether it starts with "+", how many digits, whether it has whitespace, and
 * whether it has a trunk "0" after a country code. Key names avoid "phone",
 * which log.js redacts by key.
 */
export function valueShape(value) {
  if (value === undefined) return { kind: 'missing' };
  if (value === null) return { kind: 'null' };
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value !== 'string') return { kind: Array.isArray(value) ? 'array' : typeof value };
  if (value.length === 0) return { kind: 'empty', len: 0 };
  return {
    kind: 'string',
    len: value.length,
    plus: value.startsWith('+'),
    digits: (value.match(/\d/g) ?? []).length,
    space: /\s/.test(value),
    trunk0: trunkZeroCode(value.trim()) !== null,
  };
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * Country codes whose national numbers are dialled with a trunk "0" at home
 * but NEVER carry it after the country code — Phase 13 / 03 D4.
 *
 * A parent typing "0712 345 678" next to a +254 prefix produced +254071234567,
 * a different (and invalid) number that every validator accepted. Italy (+39)
 * is deliberately absent: Italian landlines keep their leading 0 in E.164.
 * Keep in step with TRUNK_ZERO_CODES in firestore.rules and with
 * `trunkPrefix` in src/shared/constants/countries.js.
 */
export const TRUNK_ZERO_CODES = Object.freeze([
  '254', '255', '256', '250', '234', '233', '27', '44', '61', '91', '49', '33', '31',
]);

/** The country code a number wrongly keeps a trunk 0 after, or null. */
export function trunkZeroCode(phone) {
  return TRUNK_ZERO_CODES.find((cc) => String(phone).startsWith(`+${cc}0`)) ?? null;
}

/** E.164, matching the format enforced by firestore.rules. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,18}$/, 'must be a valid international phone number, e.g. +254712345678')
  .superRefine((phone, ctx) => {
    const cc = trunkZeroCode(phone);
    if (cc) {
      ctx.addIssue({
        code: 'custom',
        message: `Remove the leading 0 after +${cc} — e.g. +${cc}7… not +${cc}07…`,
      });
    }
  });

/**
 * A session slug — Phase 13 / 02 D6.
 *
 * Was `z.enum(['morning', 'evening'])`, which made every teacher-created
 * session unusable on all 18 endpoints that take one. Now: any slug that is
 * well-formed and not reserved. Whether the session actually EXISTS is checked
 * after validation by createHandler's `sessions` policy (assertSessionExists),
 * because a schema cannot read Firestore.
 */
export const sessionSchema = z
  .string()
  .trim()
  .regex(SLUG_PATTERN, 'must be a valid session address')
  .refine((slug) => !RESERVED_SLUGS.includes(slug), 'is reserved by the app');

/**
 * A student's name — Phase 13 / 03 D5. Same rule as the client
 * (registrationSchema): letters from any script, plus spaces, apostrophes
 * (straight and curly), hyphens and full stops. "Sean O'Brien", "Mary-Jane",
 * "Zoë" and "N’Golo" were all refused before. Whitespace is trimmed and runs of
 * spaces collapsed.
 */
export const STUDENT_NAME_PATTERN = /^\p{L}[\p{L}\p{M} '’.-]{1,99}$/u;
export const studentNameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(2).max(100).regex(STUDENT_NAME_PATTERN, 'may contain letters, spaces, apostrophes, hyphens and full stops'));

export const tierSchema = z.enum(['bronze', 'silver', 'gold']);

export const roleSchema = z.enum(['superadmin', 'teacher', 'student']);

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'must be a 6-digit code');

export const receiptSchema = z
  .string()
  .trim()
  .min(10, 'receipt message is too short')
  .max(500, 'receipt message is too long');

export { z };
