import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup } from '@testing-library/react';
import { resolveStudentGate, GATE } from '@utils/studentGate';
import { renderSessionPage, unmockSessionPage } from '../fixes002/sessionPageHarness';

/**
 * 003Fixes / 11 — a registration held as a possible duplicate gets its own
 * screen, ahead of "waiting for approval", whether or not approval is
 * required. It names no one else.
 */

const held = { studentName: 'Amina', approvalStatus: 'pending', blocked: false, duplicateHold: true };

describe('the gate', () => {
  it('DUPLICATE ahead of PENDING, with approval required or not', () => {
    expect(resolveStudentGate(held, { requireApproval: true }).screen).toBe(GATE.DUPLICATE);
    expect(resolveStudentGate(held, { requireApproval: false }).screen).toBe(GATE.DUPLICATE);
    expect(resolveStudentGate({ ...held, blocked: true }, { requireApproval: false }).screen).toBe(GATE.DUPLICATE);
  });

  it('once approved (the hold cleared) the normal flow follows', () => {
    expect(resolveStudentGate({ ...held, duplicateHold: false, approvalStatus: 'approved' }, { requireApproval: true }).screen).toBe(GATE.WELCOME);
    // A stale flag on an approved record never holds the student.
    expect(resolveStudentGate({ ...held, approvalStatus: 'approved' }, { requireApproval: false }).screen).toBe(GATE.WELCOME);
  });
});

describe('the held screen, through the real page', () => {
  beforeEach(() => { vi.resetModules(); sessionStorage.clear(); });
  afterEach(() => { cleanup(); unmockSessionPage(); });

  it('a held check-in shows the duplicate message (approval flag off), with Use a different number', async () => {
    await renderSessionPage({
      requireApproval: false,
      real: ['PendingApprovalScreen'],
      api: { checkinStudent: vi.fn().mockResolvedValue({ exists: true, student: held }) },
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });
    const card = await screen.findByTestId('duplicate-hold');
    expect(card.textContent).toMatch(/It looks like you may already be registered for this class with another number\. Your teacher will review this\. If you have your original number, check in with it\./);
    expect(screen.getByRole('button', { name: /Use a different number/ })).toBeTruthy();
    expect(screen.queryByTestId('welcome')).toBeNull();
  });

  it('the registration reply routes on the record written: a held one is the duplicate screen', () => {
    // The page routes a registration with resolveStudentGate(result.student);
    // the server marks a held one with duplicateHold (handler test).
    expect(resolveStudentGate({ studentName: 'New', approvalStatus: 'pending', blocked: false, duplicateHold: true }).screen).toBe(GATE.DUPLICATE);
    expect(resolveStudentGate({ studentName: 'New', approvalStatus: 'pending', blocked: false, duplicateHold: false }).screen).toBe(GATE.WELCOME);
  });

  it('the ordinary waiting screen keeps its wording', async () => {
    const { render } = await import('@testing-library/react');
    const { default: PendingApprovalScreen } = await import('@/features/registration/components/PendingApprovalScreen.jsx');
    render(<PendingApprovalScreen session="morning" studentData={{ studentName: 'Amina' }} onBack={() => {}} onRefresh={() => {}} loading={false} />);
    expect(screen.queryByTestId('duplicate-hold')).toBeNull();
    expect(screen.getByText(/just waiting on your teacher/)).toBeTruthy();
  });
});
