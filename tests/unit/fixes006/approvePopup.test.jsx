import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, renderHook, waitFor } from '@testing-library/react';
import { receiptKes } from '@features/dashboard/bulk/receiptAmount';
import ApprovePaymentModal from '@features/dashboard/components/ApprovePaymentModal';

/**
 * 006Fixes / 06 — Approve on a student's receipt asks COMPLETE or PARTIAL
 * (owner, 4 Nov 2026): complete records everything owed; partial records the
 * typed amount and shows what is still owed. The receipt's own Ksh amount is
 * shown as a hint and prefills Partial.
 */
afterEach(() => { cleanup(); vi.useRealTimers(); });

const RECEIPT = '1,200: UK2PK0FF1R Confirmed. Ksh1,200.00 paid to FOCUS ONLINE  via MPAYA. on 2/11/26 at 7:28 PM.';
function open(props = {}) {
  const onConfirm = vi.fn().mockResolvedValue({ success: true });
  const onClose = vi.fn();
  render(<ApprovePaymentModal studentName="Claire Job" sessionName="Evening" receipt={RECEIPT} owed={2750} onConfirm={onConfirm} onClose={onClose} {...props} />);
  return { onConfirm, onClose, dialog: screen.getByRole('dialog') };
}

describe('the receipt amount', () => {
  it('reads Ksh / KES amounts from M-Pesa messages, whole shillings', () => {
    expect(receiptKes(RECEIPT)).toBe(1200);
    expect(receiptKes('UJO7NBE8JO Confirmed. KSH. 2,750 paid to FOCUS ONLINE')).toBe(2750);
    expect(receiptKes('QAB1 Confirmed. Ksh 500.50 sent')).toBe(500);
    expect(receiptKes('Focus online staff')).toBeNull();
    expect(receiptKes(null)).toBeNull();
  });
});

describe('the approve pop-up', () => {
  it('shows who, the receipt, the code and what is owed, with Complete chosen', () => {
    const { dialog } = open();
    expect(within(dialog).getByText("Approve Claire Job's receipt (Evening)")).toBeTruthy();
    expect(within(dialog).getByTestId('approve-receipt').textContent).toContain('UK2PK0FF1R Confirmed');
    expect(within(dialog).getByTestId('approve-code').textContent).toContain('UK2PK0FF1R');
    expect(within(dialog).getByTestId('approve-owed').textContent).toBe('Owes KES 2,750.');
    expect(within(dialog).getByRole('radio', { name: /Complete payment/ }).checked).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Approve: record KES 2,750' })).toBeTruthy();
  });

  it('warns when Complete is chosen but the receipt shows less than is owed', () => {
    const { dialog } = open();
    expect(within(dialog).getByTestId('approve-hint').textContent).toBe('The receipt says Ksh 1,200, less than the KES 2,750 owed.');
  });

  it('Complete sends payment: full', async () => {
    const { dialog, onConfirm } = open();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Approve: record KES 2,750' })); });
    expect(onConfirm).toHaveBeenCalledWith({ payment: 'full' });
  });

  it('Partial is prefilled from the receipt, shows the remainder and sends the amount', async () => {
    const { dialog, onConfirm } = open();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Partial payment/ }));
    const input = within(dialog).getByLabelText('Amount paid (KES)');
    expect(input.value).toBe('1200');
    expect(within(dialog).getByTestId('approve-remainder').textContent)
      .toBe('Owes KES 1,550 after this. Counts in Total outstanding. Shows under Partial payment.');
    fireEvent.change(input, { target: { value: '1000' } });
    expect(within(dialog).getByTestId('approve-remainder').textContent).toMatch(/^Owes KES 1,750 after this\./);
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Approve: record KES 1,000 (partial)' })); });
    expect(onConfirm).toHaveBeenCalledWith({ payment: 'partial', amount: 1000 });
  });

  it('Partial refuses 0, the full amount, more than owed and non-numbers', () => {
    const { dialog, onConfirm } = open();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Partial payment/ }));
    const input = within(dialog).getByLabelText('Amount paid (KES)');
    for (const value of ['0', '2750', '3000', 'abc', '12.5', '']) {
      fireEvent.change(input, { target: { value } });
      const button = within(dialog).getAllByRole('button').find((b) => /^Approve/.test(b.textContent));
      expect(button.disabled, value).toBe(true);
    }
    fireEvent.change(input, { target: { value: '2750' } });
    expect(within(dialog).getByTestId('approve-error').textContent).toBe('For the full KES 2,750, choose Complete payment.');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a receipt with no Ksh amount: no hint, Partial starts empty', () => {
    const { dialog } = open({ receipt: 'Focus online staff' });
    expect(within(dialog).queryByTestId('approve-hint')).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Partial payment/ }));
    expect(within(dialog).getByLabelText('Amount paid (KES)').value).toBe('');
  });
});

describe('the dashboard sends the choice and says what happened', () => {
  async function hook(result) {
    vi.resetModules();
    const approveReceiptWithPayment = vi.fn().mockResolvedValue(result);
    const showSuccess = vi.fn();
    vi.doMock('@services/api/fees', () => ({ approveReceiptWithPayment }));
    vi.doMock('@services/api/sessions', () => ({ updateStudentRecord: vi.fn(), removeStudent: vi.fn(), manageSession: vi.fn() }));
    vi.doMock('@features/sessions/hooks/useSessions', () => ({ useSessions: () => ({ sessions: [], loading: false }) }));
    vi.doMock('@services/firebase/firestore', () => ({
      subscribeToStudents: () => () => {}, subscribeToPendingApprovals: () => () => {},
      subscribeToClassLink: () => () => {}, getZoomLinks: async () => ({}),
      blockStudent: vi.fn(), unblockStudent: vi.fn(), approveReceipt: vi.fn(), declineReceipt: vi.fn(),
    }));
    vi.doMock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess, showError: vi.fn() }), useOptionalToast: () => null }));
    vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: (k) => k === 'fees.enabled' }));
    const { useDashboard } = await import('@/features/dashboard/hooks/useDashboard.js');
    const { result: h } = renderHook(() => useDashboard());
    return { h, approveReceiptWithPayment, showSuccess };
  }

  it('complete', async () => {
    const { h, approveReceiptWithPayment, showSuccess } = await hook({ ok: true, posted: true, paid: 2750, balance: 0, partial: false });
    await act(async () => { await h.current.approveReceipt('evening', '+254711000001', 'Claire Job', { payment: 'full' }); });
    expect(approveReceiptWithPayment).toHaveBeenCalledWith({ session: 'evening', phone: '+254711000001', payment: 'full' });
    expect(showSuccess).toHaveBeenCalledWith('Receipt approved for Claire Job. KES 2,750 recorded; nothing owed.');
  });

  it('partial', async () => {
    const { h, approveReceiptWithPayment, showSuccess } = await hook({ ok: true, posted: true, paid: 1200, balance: 1550, partial: true });
    await act(async () => { await h.current.approveReceipt('evening', '+254711000001', 'Claire Job', { payment: 'partial', amount: 1200 }); });
    expect(approveReceiptWithPayment).toHaveBeenCalledWith({ session: 'evening', phone: '+254711000001', payment: 'partial', amount: 1200 });
    expect(showSuccess).toHaveBeenCalledWith('Receipt approved for Claire Job. KES 1,200 recorded; KES 1,550 still owed.');
  });

  it('nothing owed: approves with no money, as before', async () => {
    const { h, approveReceiptWithPayment, showSuccess } = await hook({ ok: true, posted: false, paid: 0, balance: 0 });
    await act(async () => { await h.current.approveReceipt('evening', '+254711000001', 'Claire Job'); });
    expect(approveReceiptWithPayment).toHaveBeenCalledWith({ session: 'evening', phone: '+254711000001' });
    expect(showSuccess).toHaveBeenCalledWith('Payment receipt approved for Claire Job');
  });
});

describe('the row hands the student to Approve', () => {
  it('onApprove gets the student record (balance and receipt) as its 4th argument', async () => {
    vi.resetModules();
    vi.doUnmock('@services/api/fees');
    const { default: StudentRow } = await import('@features/dashboard/components/StudentRow');
    const { LazyMotion, domAnimation } = await import('framer-motion');
    const student = {
      id: '+254711000001', studentName: 'Claire Job', parentPhone: '+254711000001', class: 'Form 3', subjects: 'English',
      receiptMessage: 'old', pendingReceipt: RECEIPT, receiptStatus: 'pending', blocked: true, feeBalance: 2750, approvalStatus: 'approved',
    };
    const onApprove = vi.fn().mockResolvedValue({ success: true });
    vi.useFakeTimers();
    render(<LazyMotion features={domAnimation}><table><tbody>
      <StudentRow student={student} index={0} session="evening" onApprove={onApprove} onDecline={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onBlock={vi.fn()} onUnblock={vi.fn()} />
    </tbody></table></LazyMotion>);
    const row = document.querySelector('tr.student-row-wrapper');
    fireEvent.mouseEnter(row);
    fireEvent.click(row);
    await act(async () => { vi.advanceTimersByTime(1600); });
    vi.useRealTimers();
    const approve = await waitFor(() => screen.getByRole('button', { name: /^Approve$/ }));
    await act(async () => { fireEvent.click(approve); });
    expect(onApprove).toHaveBeenCalledWith('evening', '+254711000001', 'Claire Job', expect.objectContaining({ feeBalance: 2750, pendingReceipt: RECEIPT }));
  });
});
