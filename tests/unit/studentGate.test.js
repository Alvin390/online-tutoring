import { describe, it, expect } from 'vitest';
import { resolveStudentGate, GATE } from '@utils/studentGate';

/**
 * Check-in gate — Phase 04 Part A.
 *
 * `approvalStatus` and `blocked` are orthogonal; this covers every combination,
 * plus the legacy-document cases that produced the original bypass.
 */

const student = (overrides = {}) => ({
  studentName: 'Amina',
  blocked: false,
  approvalStatus: 'approved',
  ...overrides,
});

describe('with approval required', () => {
  const opts = { requireApproval: true };

  it('pending beats everything, including blocked', () => {
    expect(resolveStudentGate(student({ approvalStatus: 'pending', blocked: true }), opts).screen)
      .toBe(GATE.PENDING);
  });

  it('pending and unblocked → pending', () => {
    expect(resolveStudentGate(student({ approvalStatus: 'pending' }), opts).screen)
      .toBe(GATE.PENDING);
  });

  it('rejected beats blocked', () => {
    expect(resolveStudentGate(student({ approvalStatus: 'rejected', blocked: true }), opts).screen)
      .toBe(GATE.REJECTED);
  });

  it('rejected surfaces the teacher reason', () => {
    const result = resolveStudentGate(
      student({ approvalStatus: 'rejected', rejectionReason: 'Receipt amount is wrong' }),
      opts
    );
    expect(result.screen).toBe(GATE.REJECTED);
    expect(result.reason).toBe('Receipt amount is wrong');
  });

  it('rejected with no reason still gives the student something to read', () => {
    const result = resolveStudentGate(student({ approvalStatus: 'rejected' }), opts);
    expect(result.reason).toBeTruthy();
  });

  it('approved and blocked → blocked', () => {
    expect(resolveStudentGate(student({ blocked: true }), opts).screen).toBe(GATE.BLOCKED);
  });

  it('approved and unblocked → welcome', () => {
    expect(resolveStudentGate(student(), opts).screen).toBe(GATE.WELCOME);
  });
});

describe('with approval disabled (the flag is off)', () => {
  const opts = { requireApproval: false };

  it('ignores a pending status entirely', () => {
    // The flag being off must behave exactly like the pre-upgrade app.
    expect(resolveStudentGate(student({ approvalStatus: 'pending' }), opts).screen)
      .toBe(GATE.WELCOME);
  });

  it('still honours a block', () => {
    expect(resolveStudentGate(student({ approvalStatus: 'pending', blocked: true }), opts).screen)
      .toBe(GATE.BLOCKED);
  });
});

describe('legacy and malformed documents', () => {
  const opts = { requireApproval: true };

  it('treats a document with no approvalStatus as approved, not pending', () => {
    // These students registered and were admitted under the old rules.
    // Sweeping them all into the approval queue would be a migration
    // masquerading as a feature flag.
    const legacy = { studentName: 'Old', blocked: false };
    expect(resolveStudentGate(legacy, opts).screen).toBe(GATE.WELCOME);
  });

  it('treats an absent `blocked` as not blocked but never as approved-by-omission', () => {
    const legacy = { studentName: 'Old', approvalStatus: 'pending' };
    expect(resolveStudentGate(legacy, opts).screen).toBe(GATE.PENDING);
  });

  it('does not treat a truthy non-true `blocked` as blocked', () => {
    // Explicit === true. A stray string would otherwise silently lock someone
    // out with no reason to show them.
    expect(resolveStudentGate(student({ blocked: 'false' }), opts).screen).toBe(GATE.WELCOME);
    expect(resolveStudentGate(student({ blocked: 1 }), opts).screen).toBe(GATE.WELCOME);
  });

  it('sends a null student to registration', () => {
    expect(resolveStudentGate(null, opts).screen).toBe(GATE.REGISTER);
    expect(resolveStudentGate(undefined, opts).screen).toBe(GATE.REGISTER);
  });

  it('passes the block reason through when blocked', () => {
    const result = resolveStudentGate(
      student({ blocked: true, blockReason: 'Fees outstanding' }),
      opts
    );
    expect(result.reason).toBe('Fees outstanding');
  });

  it('defaults options so a missing options object cannot enable approval', () => {
    expect(resolveStudentGate(student({ approvalStatus: 'pending' })).screen).toBe(GATE.WELCOME);
  });
});

describe('exhaustive matrix', () => {
  const statuses = ['pending', 'rejected', 'approved'];
  const blocks = [true, false];
  const expected = {
    'pending|true': GATE.PENDING,
    'pending|false': GATE.PENDING,
    'rejected|true': GATE.REJECTED,
    'rejected|false': GATE.REJECTED,
    'approved|true': GATE.BLOCKED,
    'approved|false': GATE.WELCOME,
  };

  for (const approvalStatus of statuses) {
    for (const blocked of blocks) {
      it(`${approvalStatus} + blocked=${blocked} → ${expected[`${approvalStatus}|${blocked}`]}`, () => {
        expect(
          resolveStudentGate(student({ approvalStatus, blocked }), { requireApproval: true }).screen
        ).toBe(expected[`${approvalStatus}|${blocked}`]);
      });
    }
  }
});
