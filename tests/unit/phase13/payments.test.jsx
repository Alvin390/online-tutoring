import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/**
 * Phase 13 / 04 — client side: live ledger + receipt chips (I2), polling
 * backoff and receipt on the student screen, M-Pesa settings card (B8d), and
 * the block-modal default (B12).
 */

beforeEach(() => vi.resetModules());

// ---------------------------------------------------------------------------
describe('D2 live fee statement', () => {
  function mockFirestore() {
    const listeners = { ledger: null, account: null };
    const unsub = { ledger: vi.fn(), account: vi.fn() };
    vi.doMock('firebase/firestore', () => ({
      collection: vi.fn((...a) => ({ kind: 'collection', path: a.slice(1).join('/') })),
      doc: vi.fn((...a) => ({ kind: 'doc', path: a.slice(1).join('/') })),
      query: vi.fn((c) => c),
      orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
      getDocs: vi.fn(async () => ({ docs: [] })),
      onSnapshot: vi.fn((ref, next) => {
        if (ref.kind === 'collection') { listeners.ledger = next; return unsub.ledger; }
        listeners.account = next; return unsub.account;
      }),
    }));
    vi.doMock('@services/firebase/config', () => ({ db: {} }));
    return { listeners, unsub };
  }

  const ledgerDoc = (id, data) => ({ id, data: () => data });
  const snapshot = (docs, added = []) => ({
    docs,
    docChanges: () => added.map((d) => ({ type: 'added', doc: d })),
  });
  const ts = (iso) => ({ toDate: () => new Date(iso) });

  async function renderTab(apiOverrides = {}) {
    const annotateLedgerEntry = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock('@services/api/fees', () => ({
      getFeeSummary: vi.fn().mockResolvedValue({ feesEnabled: true, summary: { balance: 1500 } }),
      recordPayment: vi.fn(), reverseLedgerEntry: vi.fn(), annotateLedgerEntry, ...apiOverrides,
    }));
    vi.doMock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));
    const { default: FeesTab } = await import('@/features/fees/components/FeesTab.jsx');
    const view = render(<FeesTab session="morning" phone="+254711000001" active />);
    await screen.findByText(/Current balance/);
    return { ...view, annotateLedgerEntry };
  }

  it('a payment arriving while the statement is open appears with its receipt chip, and is announced', async () => {
    const { listeners } = mockFirestore();
    await renderTab();

    const invoice = ledgerDoc('e1', { type: 'invoice', amount: 1500, method: null, reference: null, occurredAt: ts('2026-10-01T08:00:00Z'), balanceAfter: 1500 });
    act(() => listeners.ledger(snapshot([invoice], [invoice])));
    expect(screen.queryByText('TJK9XYZ8QP')).toBeNull();

    const payment = ledgerDoc('mpesa_ws1', { type: 'payment', amount: -1500, method: 'mpesa', reference: 'TJK9XYZ8QP', occurredAt: ts('2026-10-02T08:00:00Z'), balanceAfter: 0 });
    act(() => listeners.ledger(snapshot([payment, invoice], [payment])));
    act(() => listeners.account({ exists: () => true, data: () => ({ balance: 0 }) }));

    expect(screen.getByText('TJK9XYZ8QP')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy receipt TJK9XYZ8QP' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/Payment of .*1,500.* received, receipt TJK9XYZ8QP/);
    expect(screen.getByText(/fully paid/)).toBeTruthy();
  });

  it('the opening snapshot is not announced', async () => {
    const { listeners } = mockFirestore();
    await renderTab();
    const payment = ledgerDoc('p0', { type: 'payment', amount: -100, method: 'mpesa', reference: 'OLDRECEIPT', occurredAt: ts('2026-09-01T08:00:00Z'), balanceAfter: 0 });
    act(() => listeners.ledger(snapshot([payment], [payment])));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('a reconciled payment without a receipt offers to add one', async () => {
    const { listeners } = mockFirestore();
    const { annotateLedgerEntry } = await renderTab();
    const pending = ledgerDoc('mpesa_ws9', { type: 'payment', amount: -600, method: 'mpesa', reference: null, receiptPending: true, occurredAt: ts('2026-10-03T08:00:00Z'), balanceAfter: 900 });
    act(() => listeners.ledger(snapshot([pending], [pending])));

    const box = screen.getByTestId('receipt-pending-mpesa_ws9');
    fireEvent.change(box.querySelector('input[aria-label="Receipt code"]'), { target: { value: 'teach1er23' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(annotateLedgerEntry).toHaveBeenCalledWith({
      session: 'morning', phone: '+254711000001', entryId: 'mpesa_ws9', reference: 'TEACH1ER23', notMpesa: false,
    }));
  });

  it('closing the tab unsubscribes both listeners', async () => {
    const { unsub } = mockFirestore();
    const { unmount } = await renderTab();
    unmount();
    expect(unsub.ledger).toHaveBeenCalled();
    expect(unsub.account).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('D2 student payment screen', () => {
  it('polls with backoff: 2, 3, 5, 8 then every 10 s', async () => {
    const { nextPollDelay, POLL_TOTAL_MS } = await import('@/features/payments/components/PayNowPanel.jsx');
    expect([0, 1, 2, 3, 4, 5, 9].map(nextPollDelay)).toEqual([2000, 3000, 5000, 8000, 10000, 10000, 10000]);
    expect(POLL_TOTAL_MS).toBe(90_000);
    // Requests in a full 90 s window: 4 ramp + 7 steady = 11 (was up to 20).
    let t = 0; let n = 0;
    while (t + nextPollDelay(n) <= POLL_TOTAL_MS) { t += nextPollDelay(n); n += 1; }
    expect(n).toBe(11);
  });

  it('shows the M-Pesa receipt on success', async () => {
    vi.useFakeTimers();
    vi.doMock('@services/api/payments', () => ({
      initiatePayment: vi.fn().mockResolvedValue({ checkoutRequestId: 'ws1', environment: 'sandbox', customerMessage: 'Check your phone' }),
      getPaymentStatus: vi.fn().mockResolvedValue({ status: 'success', amount: 700, receivedAmount: 700, balanceAfter: 0, mpesaReceipt: 'TJK9XYZ8QP' }),
    }));
    const { default: PayNowPanel } = await import('@/features/payments/components/PayNowPanel.jsx');
    render(<PayNowPanel session="morning" phone="+254711000001" balance={700} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Pay/ })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(screen.getByTestId('mpesa-receipt').textContent).toBe('TJK9XYZ8QP');
    expect(screen.getByRole('status').textContent).toMatch(/Paid .*700/);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
describe('D4 M-Pesa settings card (B8d)', () => {
  it('env-sourced credentials: status and callback URL shown, read-only', async () => {
    vi.doMock('@services/api/payments', () => ({
      getDarajaStatus: vi.fn().mockResolvedValue({
        configured: true, source: 'env', environment: 'sandbox', shortCode: '174379', shortCodeType: 'paybill',
        verifiedAt: null, callbackUrl: 'https://x.example/api/daraja/callback/Ab3dEf6hIj9kLm2nOp5qRs',
      }),
      saveDarajaCredentials: vi.fn(), testDarajaConnection: vi.fn(),
    }));
    const { default: Card } = await import('@/features/payments/components/DarajaSettingsCard.jsx');
    render(<Card />);
    expect(await screen.findByDisplayValue(/callback\/Ab3dEf6hIj9kLm2nOp5qRs$/)).toBeTruthy();
    expect(screen.getByText('Server configuration')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy callback URL' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Test connection/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Set up M-Pesa|Replace credentials/ })).toBeNull();
  });

  it('not configured: offers set-up', async () => {
    vi.doMock('@services/api/payments', () => ({
      getDarajaStatus: vi.fn().mockResolvedValue({ configured: false, source: null, callbackUrl: null }),
      saveDarajaCredentials: vi.fn(), testDarajaConnection: vi.fn(),
    }));
    const { default: Card } = await import('@/features/payments/components/DarajaSettingsCard.jsx');
    render(<Card />);
    expect(await screen.findByRole('button', { name: 'Set up M-Pesa' })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('D5 block modal default (B12)', () => {
  async function renderTable({ feesFlag, tierRank }) {
    const postLedgerEntry = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: (k) => (k === 'fees.enabled' ? feesFlag : false) }));
    vi.doMock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank, isSuperadmin: false }) }));
    vi.doMock('@services/api/fees', () => ({ postLedgerEntry }));
    const { default: StudentTable } = await import('@/features/dashboard/components/StudentTable.jsx');
    const onBlock = vi.fn().mockResolvedValue({ success: true });
    const student = { id: '+254711000001', studentName: 'Amina', parentPhone: '+254711000001', class: 'G8', subjects: 'M', receiptMessage: 'QAB123XYZ9' };
    render(<StudentTable session="morning" students={[student]} loading={false} onDelete={vi.fn()} onEdit={vi.fn()}
      onView={vi.fn()} onExport={vi.fn()} onBlock={onBlock} onUnblock={vi.fn()} onApprove={vi.fn()} onDecline={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Block student'));
    return { postLedgerEntry, onBlock };
  }

  it('Bronze: defaults to "another reason", the fee option is disabled, and no charge is posted', async () => {
    const { postLedgerEntry, onBlock } = await renderTable({ feesFlag: true, tierRank: 1 });
    expect(screen.getByRole('radio', { name: /Unpaid fees/ }).disabled).toBe(true);
    expect(screen.getByRole('radio', { name: /Another reason/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onBlock).toHaveBeenCalled());
    expect(postLedgerEntry).not.toHaveBeenCalled();
  });

  it('fees flag off: same, even on Silver', async () => {
    await renderTable({ feesFlag: false, tierRank: 2 });
    expect(screen.getByRole('radio', { name: /Unpaid fees/ }).disabled).toBe(true);
    expect(screen.getByText(/Turn on fee tracking/)).toBeTruthy();
  });

  it('Silver with fees on: the fee block is the default', async () => {
    await renderTable({ feesFlag: true, tierRank: 2 });
    expect(screen.getByRole('radio', { name: /Unpaid fees/ }).getAttribute('aria-checked')).toBe('true');
  });
});
