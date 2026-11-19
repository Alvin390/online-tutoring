/**
 * Does approving this student's receipt ask Complete or Partial first?
 * 006Fixes / 06 (owner): only when they owe and fees are on.
 * 013Fixes / 04: and only when the school's plan records payments (Silver and
 * up). On Bronze approving lets the student back in at once, recording nothing.
 */
export function asksPaymentOnApprove({ feesOn, paymentsInPlan, owed }) {
  return feesOn === true && paymentsInPlan === true && (Number(owed) || 0) > 0;
}
