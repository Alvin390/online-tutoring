import { describe, it, expect } from 'vitest';
import { phoneCheckSchema, registrationSchema } from '@features/registration/schemas/registrationSchema';

describe('Registration Schemas', () => {
  describe('phoneCheckSchema', () => {
    it('should validate correct phone check data', () => {
      const validData = {
        country: 'KE',
        phoneNumber: '712345678',
      };

      const result = phoneCheckSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject missing country', () => {
      const invalidData = {
        phoneNumber: '712345678',
      };

      const result = phoneCheckSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject short phone number', () => {
      const invalidData = {
        country: 'KE',
        phoneNumber: '123',
      };

      const result = phoneCheckSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Phone number is required');
      }
    });
  });

  describe('registrationSchema', () => {
    it('should validate correct registration data', () => {
      const validData = {
        studentName: 'John Doe',
        class: 'Form Three',
        subjects: 'Mathematics, Physics, Chemistry',
        receiptMessage: 'M-Pesa Code: ABC123456, Amount: KES 5000, Date: Nov 19, 2025',
      };

      const result = registrationSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject name with numbers', () => {
      const invalidData = {
        studentName: 'John123',
        class: 'Form Three',
        subjects: 'Math',
        receiptMessage: 'Payment details here',
      };

      const result = registrationSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('letters and spaces');
      }
    });

    it('should reject short name', () => {
      const invalidData = {
        studentName: 'J',
        class: 'Form Three',
        subjects: 'Math',
        receiptMessage: 'Payment details',
      };

      const result = registrationSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty class', () => {
      const invalidData = {
        studentName: 'John Doe',
        class: '',
        subjects: 'Math',
        receiptMessage: 'Payment details',
      };

      const result = registrationSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject short subjects', () => {
      const invalidData = {
        studentName: 'John Doe',
        class: 'Form Three',
        subjects: 'Ma',
        receiptMessage: 'Payment details here',
      };

      const result = registrationSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject short receipt message', () => {
      const invalidData = {
        studentName: 'John Doe',
        class: 'Form Three',
        subjects: 'Mathematics',
        receiptMessage: 'Short',
      };

      const result = registrationSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject very long name', () => {
      const invalidData = {
        studentName: 'A'.repeat(101),
        class: 'Form Three',
        subjects: 'Math',
        receiptMessage: 'Payment details here',
      };

      const result = registrationSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject very long subjects', () => {
      const invalidData = {
        studentName: 'John Doe',
        class: 'Form Three',
        subjects: 'A'.repeat(201),
        receiptMessage: 'Payment details here',
      };

      const result = registrationSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject very long receipt message', () => {
      const invalidData = {
        studentName: 'John Doe',
        class: 'Form Three',
        subjects: 'Mathematics',
        receiptMessage: 'A'.repeat(501),
      };

      const result = registrationSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });
});
