import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * 011Fixes / 01 — the students table is drawn from the column list: an
 * Admission No. column after Student Name (owner), the "#0042" badge by the
 * name gone, the column only with admission numbers on, and hidden columns
 * (this device's layout) left out of the header and every row.
 */

vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));
const flags = vi.hoisted(() => ({ 'checkin.admissionNumbers': true }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => flags[k] === true }));

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const kid = (n, over = {}) => ({
  id: `+2547110${String(n).padStart(5, '0')}`, studentName: `Student ${n}`, parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: 'Form 3', subjects: 'English, Kiswahili', receiptMessage: 'QAB123XYZ9 Confirmed', receiptStatus: 'approved',
  approvalStatus: 'approved', blocked: false, feeBalance: 0, registeredAt: at(Date.parse('2026-10-01T09:00:00+03:00')), ...over,
});

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); flags['checkin.admissionNumbers'] = true; });
afterEach(() => cleanup());

async function renderTable(students = [kid(1, { admissionNumber: '0042' }), kid(2)]) {
  const { default: StudentSearchPanel } = await import('@features/dashboard/components/StudentSearchPanel.jsx');
  const noop = vi.fn();
  render(<MemoryRouter><StudentSearchPanel session="morning" sessionDoc={{ id: 'morning', name: 'Morning', classes: ['Form 3'] }}
    students={students} loading={false} onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop}
    onApprove={noop} onDecline={noop} onView={noop} /></MemoryRouter>);
  return screen.findByRole('table');
}
const headers = (table) => within(table).getAllByRole('columnheader').map((th) => th.textContent.trim());
const rowOf = (name) => screen.getByText(name).closest('tr');

describe('the Admission No. column', () => {
  it('after Student Name; the number, or "—"; no badge by the name', async () => {
    const table = await renderTable();
    expect(headers(table).slice(1)).toEqual(['Student Name', 'Admission No.', 'Parent Phone', 'Class', 'Subjects', 'Payment Receipt', 'Registered', 'Action']);
    expect(within(rowOf('Student 1')).getByTestId('cell-admissionNumber').textContent).toBe('0042');
    expect(within(rowOf('Student 2')).getByTestId('cell-admissionNumber').textContent).toBe('—');
    expect(screen.queryByTestId('row-number')).toBeNull();
  });

  it('with admission numbers off it is not shown', async () => {
    flags['checkin.admissionNumbers'] = false;
    const table = await renderTable();
    expect(headers(table)).not.toContain('Admission No.');
    expect(screen.queryByTestId('cell-admissionNumber')).toBeNull();
  });
});

describe('hidden columns (this device)', () => {
  it('left out of the header and of every row; the fixed ones stay', async () => {
    localStorage.setItem('ot.studentTable.v1', JSON.stringify({ v: 1, widths: {}, hidden: ['subjects', 'receipt', 'name'] }));
    const table = await renderTable();
    expect(headers(table).slice(1)).toEqual(['Student Name', 'Admission No.', 'Parent Phone', 'Class', 'Registered', 'Action']);
    const cells = within(rowOf('Student 1')).getAllByRole('cell');
    expect(cells).toHaveLength(headers(table).length);
    expect(screen.queryByText('English, Kiswahili')).toBeNull();
  });
});
