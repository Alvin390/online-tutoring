import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import RegistrationForm from '@/features/registration/components/RegistrationForm';
import { registrationSchema } from '@/features/registration/schemas/registrationSchema';

/**
 * 007Fixes / 02: a new student spent ~6 minutes on the M-Pesa box (Sentry 1-D
 * replay), and the logs show a "too short" rejection. Owner: "Paste the whole
 * M-Pesa message you received, not only the code." A code alone still passes.
 */

afterEach(cleanup);

const base = { studentName: 'Amina Wanjiru', class: 'Form 3', subjects: 'English, Kiswahili, Mathematics' };

describe('the M-Pesa box at registration', () => {
  it('says to paste the whole message, not only the code', () => {
    render(<RegistrationForm phoneNumber="+254711000009" onSubmit={() => {}} onBack={() => {}} loading={false} />);
    expect(screen.getByPlaceholderText('Paste the whole M-Pesa message you received')).toBeTruthy();
    expect(screen.getByText('Paste the whole M-Pesa message you received, not only the code. You may remove your balance.')).toBeTruthy();
  });

  it('the too-short message says what to do', () => {
    const result = registrationSchema.safeParse({ ...base, receiptMessage: 'paid' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe("That's too short. Paste the whole M-Pesa message (or at least the 10-character code).");
  });

  it('a 10-character M-Pesa code alone still passes', () => {
    expect(registrationSchema.safeParse({ ...base, receiptMessage: 'UK2PK0FF1R' }).success).toBe(true);
  });
});
