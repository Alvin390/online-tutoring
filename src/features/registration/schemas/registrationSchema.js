import { z } from 'zod';

export const STUDENT_NAME_PATTERN = /^\p{L}[\p{L}\p{M} '’.-]{1,99}$/u;

export const phoneCheckSchema = z.object({
  country: z.string().min(2, 'Please select a country'),
  phoneNumber: z.string().min(8, 'Phone number is required'),
});

export const registrationSchema = z.object({
  // Phase 13 / 03 D5: letters from any script plus spaces, apostrophes (straight
  // and curly), hyphens and full stops — "Sean O'Brien", "Mary-Jane", "Zoë" and
  // "N’Golo" were all refused before. Same rule as the server's studentNameSchema.
  studentName: z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name is too long')
        .regex(STUDENT_NAME_PATTERN, 'Use letters, spaces, apostrophes, hyphens or full stops')
    ),

  class: z
    .string()
    .min(1, 'Please select a class'),

  // Phase 14: the ticked subjects (a class with a subject list), or free
  // text (a class without one). The server checks the choice against the list.
  subjects: z.union([
    z.string().trim().min(3, 'Please enter at least one subject').max(500, 'Subjects list is too long'),
    z.array(z.string()).min(1, 'Please choose at least one subject').max(30, 'Too many subjects'),
  ]),

  receiptMessage: z
    .string()
    .min(10, 'Please provide detailed payment information')
    .max(500, 'Payment details are too long'),
});
