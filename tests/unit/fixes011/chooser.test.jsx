import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LAYOUT_KEY } from '@features/dashboard/components/table/studentColumns';

/**
 * 011Fixes / 03 — the column chooser (owner: "a small setting in the table
 * header where the teacher can select what columns to be displayed"). A ⚙
 * button in the first header cell (always on screen, phones too) opens a
 * checklist; Select, Student Name and Action can't be hidden; hidden columns
 * are still searched; Reset puts widths and choices back; remembered on this
 * device; Esc or a click outside closes it.
 */

vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));
const flags = vi.hoisted(() => ({ 'checkin.admissionNumbers': true }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => flags[k] === true }));

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const kid = (n, over = {}) => ({
  id: `+2547110${String(n).padStart(5, '0')}`, studentName: `Student ${n}`, parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: 'Form 3', subjects: n === 1 ? 'Chemistry, Physics' : 'English', receiptMessage: 'QAB123XYZ9 Confirmed', receiptStatus: 'approved',
  approvalStatus: 'approved', blocked: false, feeBalance: 0, registeredAt: at(Date.parse('2026-10-01T09:00:00+03:00')), ...over,
});

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); flags['checkin.admissionNumbers'] = true; });
afterEach(() => cleanup());

async function renderTable() {
  const { default: StudentSearchPanel } = await import('@features/dashboard/components/StudentSearchPanel.jsx');
  const noop = vi.fn();
  render(<MemoryRouter><StudentSearchPanel session="morning" sessionDoc={{ id: 'morning', name: 'Morning', classes: ['Form 3'] }}
    students={[kid(1), kid(2)]} loading={false} onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop}
    onApprove={noop} onDecline={noop} onView={noop} /></MemoryRouter>);
  return screen.findByRole('table');
}
const headers = () => within(screen.getByRole('table')).getAllByRole('columnheader').map((th) => th.getAttribute('data-col') ?? 'select');
const openChooser = async () => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose columns' })); });
  return screen.getByRole('dialog', { name: 'Columns' });
};

describe('the column chooser', () => {
  it('a ⚙ button in the first header cell opens a checklist; the fixed columns are ticked and can\'t be unticked', async () => {
    await renderTable();
    const button = screen.getByRole('button', { name: 'Choose columns' });
    expect(button.closest('th').classList.contains('select-col-head')).toBe(true);
    const menu = await openChooser();
    const boxes = within(menu).getAllByRole('checkbox');
    expect(boxes.map((b) => b.closest('label').textContent.trim())).toEqual([
      'Select', 'Student Name', 'Admission No.', 'Parent Phone', 'Class', 'Subjects', 'Payment Receipt', 'Registered', 'Action',
    ]);
    for (const name of ['Select', 'Student Name', 'Action']) {
      const box = within(menu).getByRole('checkbox', { name });
      expect(box.checked).toBe(true);
      expect(box.disabled).toBe(true);
    }
    expect(menu.textContent).toMatch(/Hidden columns are still searched\./);
  });

  it('untick Subjects and Payment Receipt: gone from the table, and still hidden after a reload', async () => {
    await renderTable();
    const menu = await openChooser();
    await act(async () => { fireEvent.click(within(menu).getByRole('checkbox', { name: 'Subjects' })); });
    await act(async () => { fireEvent.click(within(menu).getByRole('checkbox', { name: 'Payment Receipt' })); });
    expect(headers()).not.toContain('subjects');
    expect(headers()).not.toContain('receipt');
    expect(screen.queryByText('Chemistry, Physics')).toBeNull();
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)).hidden).toEqual(['subjects', 'receipt']);
    cleanup();
    await renderTable();
    expect(headers()).not.toContain('subjects');
  });

  it('a hidden column is still searched', async () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ v: 1, widths: {}, hidden: ['subjects'] }));
    await renderTable();
    await act(async () => { fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Chemistry' } }); });
    await screen.findByText('Student 1');
    expect(screen.queryByText('Student 2')).toBeNull();
  });

  it('Reset columns: every column back, widths back', async () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ v: 1, widths: { subjects: 400 }, hidden: ['class', 'registered'] }));
    await renderTable();
    const menu = await openChooser();
    await act(async () => { fireEvent.click(within(menu).getByRole('button', { name: 'Reset columns' })); });
    expect(headers()).toEqual(['select', 'name', 'admissionNumber', 'phone', 'class', 'subjects', 'receipt', 'registered', 'action']);
    expect(localStorage.getItem(LAYOUT_KEY)).toBeNull();
  });

  it('Esc closes and returns focus to the button; a click outside closes', async () => {
    await renderTable();
    let menu = await openChooser();
    await act(async () => { fireEvent.keyDown(menu, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog', { name: 'Columns' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose columns' }));
    menu = await openChooser();
    await act(async () => { fireEvent.pointerDown(document.body); });
    expect(screen.queryByRole('dialog', { name: 'Columns' })).toBeNull();
  });

  it('resizing the window closes it without an error (found by the browser check)', async () => {
    await renderTable();
    await openChooser();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = [];
    const onError = (e) => { thrown.push(e.message); e.preventDefault(); };
    window.addEventListener('error', onError);
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    window.removeEventListener('error', onError);
    expect(screen.queryByRole('dialog', { name: 'Columns' })).toBeNull();
    expect(thrown).toEqual([]);
    errors.mockRestore();
  });

  it('with admission numbers off, Admission No. isn\'t offered', async () => {
    flags['checkin.admissionNumbers'] = false;
    await renderTable();
    const menu = await openChooser();
    expect(within(menu).queryByRole('checkbox', { name: 'Admission No.' })).toBeNull();
  });
});
