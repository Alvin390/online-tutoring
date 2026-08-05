/**
 * Student check-in gate — Phase 04 Part A.
 *
 * `approvalStatus` and `blocked` are ORTHOGONAL and must never be conflated: a
 * student can be approved-and-blocked (paid once, now behind on fees) or
 * pending-and-unblocked (brand new). Collapsing them into one boolean is how
 * that distinction gets lost.
 *
 * Resolution order, highest precedence first:
 *
 *   | approvalStatus | blocked | screen   |
 *   |----------------|---------|----------|
 *   | pending        | any     | pending  |
 *   | rejected       | any     | rejected |
 *   | approved       | true    | blocked  |
 *   | approved       | false   | welcome  |
 *
 * Extracted as a pure function rather than nested conditionals in two
 * near-identical page components, so it can be tested exhaustively and cannot
 * drift between them.
 *
 * DEFENSIVE DEFAULTS. A document written before Phase 01 has no `blocked` and
 * no `approvalStatus` field. `undefined` is falsy, and the original code read
 * `if (data.blocked)` — which is exactly how an unapproved registration walked
 * straight into class. Every default below is therefore the SAFE value, not
 * the convenient one.
 */

export const GATE = {
  PENDING: 'pending',
  REJECTED: 'rejected',
  BLOCKED: 'blocked',
  WELCOME: 'welcome',
  REGISTER: 'register',
};

/**
 * @param {object|null} student  the projection returned by /api/student/checkin
 * @param {object} [options]
 * @param {boolean} [options.requireApproval]  the registration.requireApproval flag
 * @returns {{screen: string, reason: string|null}}
 */
export function resolveStudentGate(student, { requireApproval = false } = {}) {
  if (!student) return { screen: GATE.REGISTER, reason: null };

  // Explicit `=== true`, never truthiness: a legacy document has no field at
  // all, and a string "false" would otherwise read as blocked.
  const isBlocked = student.blocked === true;

  // A legacy document with no approvalStatus is treated as APPROVED, not
  // pending. Those students registered and were admitted under the old rules;
  // retroactively pushing every one of them into the approval queue would be a
  // migration disguised as a feature flag. New registrations always carry an
  // explicit 'pending', enforced by firestore.rules.
  const approval = student.approvalStatus ?? 'approved';

  if (requireApproval) {
    if (approval === 'pending') {
      return { screen: GATE.PENDING, reason: null };
    }
    if (approval === 'rejected') {
      return {
        screen: GATE.REJECTED,
        reason: student.rejectionReason || 'Your registration was not approved.',
      };
    }
  }

  if (isBlocked) {
    return {
      screen: GATE.BLOCKED,
      reason: student.blockReason || null,
    };
  }

  return { screen: GATE.WELCOME, reason: null };
}
