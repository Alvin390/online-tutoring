import { describe, it, expect } from 'vitest';
import { asksPaymentOnApprove } from '@features/dashboard/bulk/approveChoice';

/**
 * 013Fixes / 04 — approving one student's receipt asks Complete or Partial only
 * when fees are on, the school's plan records payments (Silver and up) and the
 * student owes. On Bronze it lets them back in at once, recording nothing.
 */
describe('asksPaymentOnApprove', () => {
  it('asks on a plan with fee payments when the student owes', () => {
    expect(asksPaymentOnApprove({ feesOn: true, paymentsInPlan: true, owed: 2750 })).toBe(true);
  });

  it('never asks on a plan without fee payments (Bronze), whatever is owed', () => {
    expect(asksPaymentOnApprove({ feesOn: true, paymentsInPlan: false, owed: 2750 })).toBe(false);
  });

  it('never asks with fees off, or when nothing is owed', () => {
    expect(asksPaymentOnApprove({ feesOn: false, paymentsInPlan: true, owed: 2750 })).toBe(false);
    expect(asksPaymentOnApprove({ feesOn: true, paymentsInPlan: true, owed: 0 })).toBe(false);
    expect(asksPaymentOnApprove({ feesOn: true, paymentsInPlan: true, owed: undefined })).toBe(false);
  });
});
