import { z } from 'zod';
import { badRequest } from './errors.js';

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
    throw badRequest(`${path}: ${first?.message ?? 'invalid value'}`, 'validation_failed');
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** E.164, matching the format enforced by firestore.rules. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,18}$/, 'must be a valid international phone number, e.g. +254712345678');

export const sessionSchema = z.enum(['morning', 'evening']);

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
