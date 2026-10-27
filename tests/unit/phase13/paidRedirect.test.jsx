import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * A blocked student who clears their balance through M-Pesa is taken straight
 * to class: success message, a short pause, a re-check, then the redirect.
 * A partial payment, or a block that still stands, leaves them where they are.
 */

const PHONE = '+254711000009';
const blockedStudent = { studentName: 'Amina', blocked: true, feeBalance: 700, approvalStatus: 'approved', receiptStatus: 'approved' };
const admitted = { ...blockedStudent, blocked: false, feeBalance: 0 };

let reg;
// vi.doMock outlives vi.resetModules, so every mocked id is unmocked after each test.
const MOCKED = [
  '@features/registration/hooks/useRegistration', '@/features/registration/hooks/useRegistration',
  '@shared/config/FlagsContext', '@/features/registration/components/CheckinCard',
  '@/features/registration/components/BlockedStudentScreen', '@/features/registration/components/SuccessScreen',
  '@services/api/public', '@features/payments/components/PayNowPanel', '@services/api/reports',
];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const id of MOCKED) vi.doUnmock(id);
});

async function renderPage({ afterPayment, paidResult = { status: 'success', balanceAfter: 0 } }) {
  reg = {
    loading: false,
    studentData: null,
    // 002Fixes / 03: the hook owns the number and the flow generation.
    phoneNumber: PHONE,
    resetFlow: vi.fn(),
    currentFlow: () => 0,
    classLink: null,
    provider: 'zoom',
    countdown: 0,
    // First call: the check-in (blocked). Later calls: the re-checks after paying.
    checkStudent: vi.fn()
      .mockResolvedValueOnce({ exists: true, data: blockedStudent })
      .mockImplementation(async () => ({ exists: true, data: afterPayment.shift() ?? afterPayment.last })),
    register: vi.fn(),
    redirectToZoom: vi.fn().mockResolvedValue({ success: true }),
    submitReceipt: vi.fn(),
    resubmit: vi.fn(),
    joinNow: vi.fn(),
  };
  afterPayment.last = afterPayment.at(-1);
  vi.doMock('@features/registration/hooks/useRegistration', () => ({ useRegistration: () => ({ ...reg, studentData: blockedStudent }) }));
  vi.doMock('@/features/registration/hooks/useRegistration', () => ({ useRegistration: () => ({ ...reg, studentData: blockedStudent }) }));
  vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));
  vi.doMock('@/features/registration/components/CheckinCard', () => ({
    default: ({ onSubmit }) => <button type="button" onClick={() => onSubmit(PHONE)}>Check in</button>,
  }));
  vi.doMock('@/features/registration/components/BlockedStudentScreen', () => ({
    default: ({ onPaid }) => <button type="button" onClick={() => onPaid(paidResult)}>Simulate M-Pesa success</button>,
  }));
  vi.doMock('@/features/registration/components/SuccessScreen', () => ({ default: () => <div data-testid="to-class">Opening class</div> }));

  const { default: SessionPage } = await import('@/features/registration/components/SessionPage.jsx');
  render(<MemoryRouter><SessionPage session="morning" label="Morning" icon="bi-sun" gradient="#000" /></MemoryRouter>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Simulate M-Pesa success' })); });
}

describe('M-Pesa clears the balance → straight to class', () => {
  it('re-checks after the success message and opens the class', async () => {
    await renderPage({ afterPayment: [admitted] });
    // The success message stays up for a moment first.
    expect(reg.redirectToZoom).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(reg.checkStudent).toHaveBeenCalledTimes(2);
    expect(reg.redirectToZoom).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('to-class')).toBeTruthy();
  });

  it('retries the check while the unblock is still landing', async () => {
    await renderPage({ afterPayment: [blockedStudent, admitted] });
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(reg.redirectToZoom).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(reg.checkStudent).toHaveBeenCalledTimes(3);
    expect(reg.redirectToZoom).toHaveBeenCalledTimes(1);
  });

  it('a block that still stands (teacher reason) is shown, not the class', async () => {
    await renderPage({ afterPayment: [{ ...blockedStudent, feeBalance: 0, blockReason: 'See the teacher' }] });
    await act(async () => { await vi.advanceTimersByTimeAsync(2100 + 1600 * 3); });
    expect(reg.checkStudent).toHaveBeenCalledTimes(4); // check-in + 3 re-checks
    expect(reg.redirectToZoom).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Simulate M-Pesa success' })).toBeTruthy();
  });

  it('a partial payment does not re-check or redirect', async () => {
    await renderPage({ afterPayment: [admitted], paidResult: { status: 'success', balanceAfter: 300 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(reg.checkStudent).toHaveBeenCalledTimes(1);
    expect(reg.redirectToZoom).not.toHaveBeenCalled();
  });
});

describe('the blocked screen passes onPaid to the payment panel', () => {
  // STK push is commented out for the pilot (BlockedStudentScreen.jsx, "STK").
  it.skip('PayNowPanel receives the handler', async () => {
    const seen = vi.fn();
    vi.doMock('@services/api/public', () => ({
      getPublicBootstrap: vi.fn().mockResolvedValue({ flags: {}, sessions: [], payments: { mpesa: true } }),
    }));
    vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: (k) => k === 'fees.enabled' }));
    vi.doMock('@features/payments/components/PayNowPanel', () => ({
      default: ({ onPaid }) => <button type="button" onClick={() => onPaid({ balanceAfter: 0 })}>pay</button>,
    }));
    const { default: BlockedStudentScreen } = await import('@/features/registration/components/BlockedStudentScreen.jsx');
    render(<BlockedStudentScreen session="morning" studentData={blockedStudent} phoneNumber={PHONE}
      onSubmitReceipt={vi.fn()} onBack={vi.fn()} onPaid={seen} />);
    fireEvent.click(await screen.findByRole('button', { name: 'pay' }));
    expect(seen).toHaveBeenCalledWith({ balanceAfter: 0 });
  });
});

describe('superadmin inbox: delete a report', () => {
  it('asks first, deletes, and removes it from the list', async () => {
    const api = {
      listReports: vi.fn()
        .mockResolvedValueOnce({ items: [{ id: 'r1', number: 'BUG-1', title: 'Broken', status: 'new' }], counts: { new: 1 } })
        .mockResolvedValue({ items: [], counts: {} }),
      getReport: vi.fn().mockResolvedValue({ report: { id: 'r1', number: 'BUG-1', title: 'Broken', status: 'new', teacher: 'T', submittedBy: {}, attachments: [], internalNotes: [], email: {} } }),
      deleteReport: vi.fn().mockResolvedValue({ ok: true, deleted: true }),
      setReportStatus: vi.fn(), addReportNote: vi.fn(), resendReportEmail: vi.fn(),
    };
    vi.doMock('@services/api/reports', () => api);
    const { default: ReportsInbox } = await import('@/features/reports/components/ReportsInbox.jsx');
    render(<ReportsInbox type="bug" initialReportId="r1" />);

    fireEvent.click(await screen.findByTestId('report-delete'));
    expect(api.deleteReport).not.toHaveBeenCalled(); // confirmation first
    expect(screen.getByText('Delete BUG-1?')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete report' })); });

    expect(api.deleteReport).toHaveBeenCalledWith('r1');
    expect(screen.queryByTestId('report-detail')).toBeNull();
    expect(await screen.findByText('Nothing here.')).toBeTruthy();
  });
});
