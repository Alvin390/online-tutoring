import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

/**
 * 007Fixes / 09 — marking someone as staff from the dashboard (owner,
 * 2026-11-11): a switch in the student's edit view and "Mark as staff" on the
 * selection bar, both through one confirmation that says what will happen:
 * the balance that will be closed, and the same number's record in the other
 * session (ticked by default).
 */

beforeEach(() => { vi.resetModules(); });
afterEach(() => { cleanup(); });

const brian = { session: 'morning', sessionName: 'Morning', phone: '+254700000469', name: 'Brian Juma', balance: 2750 };

describe('the confirmation', () => {
  async function dialog(props) {
    const { default: MarkStaffDialog } = await import('@features/dashboard/staff/MarkStaffDialog');
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<MarkStaffDialog people={[brian]} others={[]} onConfirm={onConfirm} onCancel={onCancel} {...props} />);
    return { onConfirm, onCancel };
  }

  it('one person who owes, also in the evening: names them, the balance to close, and the other record (ticked)', async () => {
    const { onConfirm } = await dialog({ others: [{ session: 'evening', sessionName: 'Evening', phone: brian.phone, balance: 1500 }] });
    const box = screen.getByRole('dialog', { name: 'Mark Brian Juma as staff?' });
    expect(box.textContent).toMatch(/aren.t counted as students, can.t be blocked, and still get the class link/);
    expect(box.textContent).toMatch(/Their balance of KES 2,750 will be closed as "Staff, no fee"/);
    // The label (linked by htmlFor) is the checkbox's accessible name.
    const also = screen.getByRole('checkbox', { name: /Also mark their Evening record \(owes KES 1,500, also closed\)/ });
    expect(also.checked).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark as staff' })); });
    expect(onConfirm).toHaveBeenCalledWith({ alsoOtherSession: true });
  });

  it('unticking the other record marks this one only', async () => {
    const { onConfirm } = await dialog({ others: [{ session: 'evening', sessionName: 'Evening', phone: brian.phone, balance: 0 }] });
    fireEvent.click(screen.getByRole('checkbox', { name: /Also mark their Evening record/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark as staff' })); });
    expect(onConfirm).toHaveBeenCalledWith({ alsoOtherSession: false });
  });

  it('nothing owed and no other record: no balance line, no checkbox', async () => {
    await dialog({ people: [{ ...brian, balance: 0 }] });
    expect(screen.getByRole('dialog').textContent).not.toMatch(/balance/i);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('several people: the count, the total to close, and the other records found', async () => {
    const people = [brian, { ...brian, phone: '+254700000544', name: 'Brian Kiplimo', balance: 5500 }, { ...brian, phone: '+254700000618', name: 'Cecilia', balance: 0 }];
    await dialog({ people, others: [{ session: 'evening', sessionName: 'Evening', phone: '+254700000544', balance: 0 }, { session: 'evening', sessionName: 'Evening', phone: '+254700000469', balance: 0 }] });
    const box = screen.getByRole('dialog', { name: 'Mark 3 people as staff?' });
    expect(box.textContent).toMatch(/KES 8,250 owed in total will be closed as "Staff, no fee"/);
    expect(screen.getByRole('checkbox', { name: /Also mark their records in other sessions \(2 found\)/ }).checked).toBe(true);
  });

  it('Cancel closes without marking', async () => {
    const { onConfirm, onCancel } = await dialog({});
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('who and what', () => {
  it('otherRecords finds the same number in other sessions, not already chosen, not already staff', async () => {
    const { otherRecords } = await import('@features/dashboard/staff/markStaffText');
    const rosters = {
      morning: [{ id: '+254700000001', feeBalance: 100 }],
      evening: [{ id: '+254700000001', feeBalance: 1500 }, { id: '+254700000002', staff: true }, { id: '+254700000003' }],
    };
    const people = [{ session: 'morning', phone: '+254700000001' }, { session: 'morning', phone: '+254700000002' }, { session: 'evening', phone: '+254700000003' }];
    const found = otherRecords(people, rosters, { morning: 'Morning', evening: 'Evening' });
    expect(found).toEqual([{ session: 'evening', sessionName: 'Evening', phone: '+254700000001', balance: 1500 }]);
  });

  it('the toast says how many and what was closed', async () => {
    const { markedToast } = await import('@features/dashboard/staff/markStaffText');
    expect(markedToast({ marked: 5, closedTotal: 8250 })).toBe('5 marked as staff. KES 8,250 closed.');
    expect(markedToast({ marked: 1, closedTotal: 0 })).toBe('1 marked as staff.');
  });
});

describe('where marking starts', () => {
  const student = { id: '+254700000469', studentName: 'Brian Juma', class: 'Form 3', subjects: 'English', receiptMessage: 'Focus online staff', feeBalance: 2750, approvalStatus: 'approved' };

  async function table(extra = {}) {
    vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));
    vi.doMock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));
    vi.doMock('@services/api/fees', () => ({ postLedgerEntry: vi.fn() }));
    const { default: StudentTable } = await import('@/features/dashboard/components/StudentTable.jsx');
    const onMarkStaff = vi.fn();
    render(<StudentTable session="morning" students={[student]} loading={false} onDelete={vi.fn()} onEdit={vi.fn()}
      onView={vi.fn()} onExport={vi.fn()} onBlock={vi.fn()} onUnblock={vi.fn()} onApprove={vi.fn()} onDecline={vi.fn()}
      onBulkAction={vi.fn()} onMarkStaff={onMarkStaff} {...extra} />);
    return onMarkStaff;
  }

  it('the edit view has "This is a teacher (staff)"; switching it on asks to mark them', async () => {
    const onMarkStaff = await table();
    fireEvent.click(screen.getByTitle('Edit student'));
    const sw = screen.getByRole('switch', { name: /This is a teacher \(staff\)/ });
    expect(sw.checked).toBe(false);
    await act(async () => { fireEvent.click(sw); });
    expect(onMarkStaff).toHaveBeenCalledWith([{ session: 'morning', phone: student.id, name: 'Brian Juma', balance: 2750 }]);
  });

  it('the selection bar offers "Mark as staff" for the ticked students', async () => {
    const onMarkStaff = await table();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Brian Juma' }));
    const button = await screen.findByRole('button', { name: /Mark as staff/ });
    await act(async () => { fireEvent.click(button); });
    expect(onMarkStaff).toHaveBeenCalledWith([{ session: 'morning', phone: student.id, name: 'Brian Juma', balance: 2750 }], expect.any(Function));
  });

  it('without onMarkStaff (e.g. fees views that do not offer it) there is no switch and no button', async () => {
    await table({ onMarkStaff: undefined });
    fireEvent.click(screen.getByTitle('Edit student'));
    expect(screen.queryByRole('switch', { name: /staff/ })).toBeNull();
  });
});
