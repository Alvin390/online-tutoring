import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * 013Fixes / 05 — on a plan without fees no money is shown: the student
 * screens (the server says `feesShown: false`), the money filters, the
 * "Balance owed" sort and the row's partial badge. Silver is unchanged.
 */

const flags = vi.hoisted(() => ({ 'fees.enabled': true }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => flags[k] === true, useFlagsLoaded: () => true }));
vi.mock('@features/payments/hooks/useMpesaAvailable', () => ({ useMpesaAvailable: () => false, useMpesaOffer: () => ({ available: false, demo: false }) }));

beforeEach(() => { flags['fees.enabled'] = true; });

describe('student screens', () => {
  it('blocked: no amount or "Balance of KES" when the server says money is not shown', async () => {
    const { default: BlockedStudentScreen } = await import('@features/registration/components/BlockedStudentScreen');
    const student = { studentName: 'Amina', blocked: true, blockReason: '', feeBalance: 0, feesShown: false, receiptStatus: 'approved' };
    render(<MemoryRouter><BlockedStudentScreen session="morning" studentData={student} phoneNumber="+254711000009" onSubmitReceipt={vi.fn()} onBack={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByText(/Amount outstanding/)).toBeNull();
    expect(screen.queryByText(/Balance of KES/)).toBeNull();
    expect(screen.getByPlaceholderText(/Please Paste Entire M-PESA receipt message here/)).toBeTruthy();
  });

  it('blocked on Silver: the amount as before', async () => {
    const { default: BlockedStudentScreen } = await import('@features/registration/components/BlockedStudentScreen');
    const student = { studentName: 'Amina', blocked: true, blockReason: '', feeBalance: 1500, feesShown: true, receiptStatus: 'approved' };
    render(<MemoryRouter><BlockedStudentScreen session="morning" studentData={student} phoneNumber="+254711000009" onSubmitReceipt={vi.fn()} onBack={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText(/Amount outstanding/)).toBeTruthy();
  });

  it('welcome back: no fee status at all', async () => {
    const { default: WelcomeBackCard } = await import('@features/registration/components/WelcomeBackCard');
    const student = { studentName: 'Amina', class: 'Form 3', feeBalance: 0, feesShown: false };
    render(<MemoryRouter><WelcomeBackCard session="morning" studentData={student} onJoinNow={vi.fn()} onBack={vi.fn()} autoJoin={false} /></MemoryRouter>);
    expect(screen.queryByText(/Fees fully paid|Fees outstanding|Account in credit/)).toBeNull();
  });

  it('welcome back on Silver: the fee status as before', async () => {
    const { default: WelcomeBackCard } = await import('@features/registration/components/WelcomeBackCard');
    const student = { studentName: 'Amina', class: 'Form 3', feeBalance: 0, feesShown: true };
    render(<MemoryRouter><WelcomeBackCard session="morning" studentData={student} onJoinNow={vi.fn()} onBack={vi.fn()} autoJoin={false} /></MemoryRouter>);
    expect(screen.getByText(/Fees fully paid/)).toBeTruthy();
  });
});

describe('the dashboard filters and rows', () => {
  const state = { q: '', classes: [], statuses: [], subjects: [], from: '', to: '', sort: 'newest' };

  it('no Owes fees / Partial payment chips and no "Balance owed" sort when hidden', async () => {
    const { default: StudentFilters } = await import('@features/dashboard/components/StudentFilters');
    render(<StudentFilters state={state} statusCounts={{}} subjectOptions={[]} subjectCounts={{}}
      onToggleStatus={vi.fn()} onToggleSubject={vi.fn()} onRange={vi.fn()} onSort={vi.fn()}
      hiddenStatuses={['owes', 'partial', 'scheduled']} moneyShown={false} />);
    const group = screen.getByRole('group', { name: 'Filter by status' });
    expect(group.textContent).not.toMatch(/Owes fees|Partial payment|Block scheduled/);
    expect(group.textContent).toMatch(/Receipt to review/);
    expect(screen.queryByRole('option', { name: /Balance owed/ })).toBeNull();
  });

  it('all chips and the balance sort by default (Silver)', async () => {
    const { default: StudentFilters } = await import('@features/dashboard/components/StudentFilters');
    render(<StudentFilters state={state} statusCounts={{}} subjectOptions={[]} subjectCounts={{}}
      onToggleStatus={vi.fn()} onToggleSubject={vi.fn()} onRange={vi.fn()} onSort={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Filter by status' }).textContent).toMatch(/Owes fees.*Partial payment/);
    expect(screen.getByRole('option', { name: /Balance owed/ })).toBeTruthy();
  });
});
