import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

/**
 * 003Fixes / 01 — the Fees tab must not flash "Fee tracking is turned off"
 * while it is still finding out whether fees are on.
 *
 * The hook started with `feesEnabled: false` and `loading: false`. Firestore's
 * cache answers the ledger listener before /api/fees/summary replies, so for a
 * moment the tab read "off, and done loading" and showed the turned-off notice,
 * then swapped to the ledger: the "locked, then the ledger" the owner saw.
 */

const OFF = /Fee tracking is turned off/;

let summary;
beforeEach(() => {
  vi.resetModules();
  summary = {};
  summary.promise = new Promise((resolve, reject) => { summary.resolve = resolve; summary.reject = reject; });
  vi.doMock('firebase/firestore', () => ({
    collection: vi.fn(() => ({ kind: 'collection' })),
    doc: vi.fn(() => ({ kind: 'doc' })),
    query: vi.fn((c) => c),
    orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
    getDocs: vi.fn(async () => ({ docs: [] })),
    // The cache answers at once, before the summary request.
    onSnapshot: vi.fn((ref, next) => {
      if (ref.kind === 'collection') next({ docs: [], docChanges: () => [] });
      else next({ exists: () => false, data: () => null });
      return () => {};
    }),
  }));
  vi.doMock('@services/firebase/config', () => ({ db: {} }));
  vi.doMock('@services/api/fees', () => ({
    getFeeSummary: vi.fn(() => summary.promise),
    recordPayment: vi.fn(), reverseLedgerEntry: vi.fn(), annotateLedgerEntry: vi.fn(),
  }));
  vi.doMock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));
});
afterEach(() => {
  cleanup();
  for (const m of ['firebase/firestore', '@services/firebase/config', '@services/api/fees', '@/context/ToastContext']) vi.doUnmock(m);
});

async function renderTab() {
  const { default: FeesTab } = await import('@/features/fees/components/FeesTab.jsx');
  render(<FeesTab session="morning" phone="+254711000001" active />);
}

describe('the Fees tab while it loads', () => {
  it('shows a placeholder, never the turned-off notice, until the summary says fees are on', async () => {
    await renderTab();
    expect(screen.queryByText(OFF)).toBeNull();
    expect(screen.getByTestId('fees-loading')).toBeTruthy();
    await act(async () => { summary.resolve({ feesEnabled: true, summary: { balance: 1500 } }); });
    expect(screen.queryByText(OFF)).toBeNull();
    expect(screen.getByText(/Current balance/)).toBeTruthy();
  });

  it('still says fees are off when the server says so', async () => {
    await renderTab();
    await act(async () => { summary.resolve({ feesEnabled: false, summary: null }); });
    expect(screen.getByText(OFF)).toBeTruthy();
  });

  it('a failed summary offers a retry instead of claiming fees are off', async () => {
    await renderTab();
    await act(async () => { summary.reject(Object.assign(new Error('timeout'), { code: 'timeout' })); });
    expect(screen.queryByText(OFF)).toBeNull();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy();
  });
});
