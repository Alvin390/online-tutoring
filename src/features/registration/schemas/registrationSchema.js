import { z } from 'zod';

export const phoneCheckSchema = z.object({
  country: z.string().min(2, 'Please select a country'),
  phoneNumber: z.string().min(8, 'Phone number is required'),
});

export const registrationSchema = z.object({
  studentName: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name is too long')
    .regex(/^[a-zA-Z\s]+$/, 'Name can only contain letters and spaces'),

  class: z
    .string()
    .min(1, 'Please select a class'),

  subjects: z
    .string()
    .min(3, 'Please enter at least one subject')
    .max(200, 'Subjects list is too long'),

  receiptMessage: z
    .string()
    .min(10, 'Please provide detailed payment information')
    .max(500, 'Payment details are too long'),
});
