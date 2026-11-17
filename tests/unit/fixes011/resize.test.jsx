import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { STUDENT_COLUMNS, LAYOUT_KEY } from '@features/dashboard/components/table/studentColumns';

/**
 * 011Fixes / 02 — resizable columns, like Excel (laptop and tablet: 768 px
 * and wider). Fixed widths (<colgroup>); a handle on each resizable header's
 * right edge: drag (never below the column's minimum), double-click to reset,
 * ←/→ (Shift: bigger steps); remembered on this device. Phones: no handles,
 * the table as today.
 */

vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => k === 'checkin.admissionNumbers' }));

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const kid = (n) => ({
  id: `+2547110${String(n).padStart(5, '0')}`, studentName: `Student ${n}`, parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: 'Form 3', subjects: 'English, Kiswahili', receiptMessage: 'QAB123XYZ9 Confirmed', receiptStatus: 'approved',
  approvalStatus: 'approved', blocked: false, feeBalance: 0, registeredAt: at(Date.parse('2026-10-01T09:00:00+03:00')),
});
const DEFAULT = Object.fromEntries(STUDENT_COLUMNS.map((c) => [c.id, c]));
const saved = () => JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null');
const setWide = (wide) => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: wide && /min-width:\s*768px/.test(query), media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
};

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setWide(true); });
afterEach(() => cleanup());

async function renderTable() {
  const { default: StudentSearchPanel } = await import('@features/dashboard/components/StudentSearchPanel.jsx');
  const noop = vi.fn();
  render(<MemoryRouter><StudentSearchPanel session="morning" sessionDoc={{ id: 'morning', name: 'Morning', classes: ['Form 3'] }}
    students={[kid(1), kid(2)]} loading={false} onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop}
    onApprove={noop} onDecline={noop} onView={noop} /></MemoryRouter>);
  return screen.findByRole('table');
}
const col = (table, id) => table.querySelector(`col[data-col="${id}"]`);
const handle = (name) => screen.getByRole('separator', { name: `Resize ${name}` });
const drag = async (el, dx) => {
  await act(async () => {
    fireEvent.pointerDown(el, { clientX: 500, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 500 + dx, pointerId: 1 });
    await new Promise((r) => { requestAnimationFrame(r); });
    fireEvent.pointerUp(window, { clientX: 500 + dx, pointerId: 1 });
  });
};

describe('fixed widths', () => {
  it('a <col> per shown column at its default width; the table as wide as its columns', async () => {
    const table = await renderTable();
    expect(col(table, 'subjects').style.width).toBe(`${DEFAULT.subjects.width}px`);
    expect(col(table, 'name').style.width).toBe(`${DEFAULT.name.width}px`);
    const sum = STUDENT_COLUMNS.reduce((n, c) => n + c.width, 0);
    expect(table.style.width).toBe(`${sum}px`);
    expect(table.className).toMatch(/student-table-fixed/);
  });
});

describe('dragging a column edge', () => {
  it('widens the column, and the width is remembered on this device', async () => {
    const table = await renderTable();
    await drag(handle('Subjects'), 60);
    expect(col(table, 'subjects').style.width).toBe(`${DEFAULT.subjects.width + 60}px`);
    expect(saved().widths.subjects).toBe(DEFAULT.subjects.width + 60);
    cleanup();
    const again = await renderTable();
    expect(col(again, 'subjects').style.width).toBe(`${DEFAULT.subjects.width + 60}px`);
  });

  it('never narrower than the column\'s minimum', async () => {
    const table = await renderTable();
    await drag(handle('Class'), -500);
    expect(col(table, 'class').style.width).toBe(`${DEFAULT.class.minWidth}px`);
  });

  it('double-click puts the column back to its default width', async () => {
    const table = await renderTable();
    await drag(handle('Parent Phone'), 40);
    await act(async () => { fireEvent.doubleClick(handle('Parent Phone')); });
    expect(col(table, 'phone').style.width).toBe(`${DEFAULT.phone.width}px`);
    expect(saved()?.widths?.phone).toBeUndefined();
  });

  it('keys: → widens by 10, Shift+← narrows by 40', async () => {
    const table = await renderTable();
    await act(async () => { fireEvent.keyDown(handle('Payment Receipt'), { key: 'ArrowRight' }); });
    expect(col(table, 'receipt').style.width).toBe(`${DEFAULT.receipt.width + 10}px`);
    await act(async () => { fireEvent.keyDown(handle('Payment Receipt'), { key: 'ArrowLeft', shiftKey: true }); });
    expect(col(table, 'receipt').style.width).toBe(`${DEFAULT.receipt.width - 30}px`);
  });

  it('the checkbox and Action columns have no handle; a handle is labelled for screen readers', async () => {
    await renderTable();
    const names = screen.getAllByRole('separator').map((s) => s.getAttribute('aria-label'));
    expect(names).toEqual(['Resize Student Name', 'Resize Admission No.', 'Resize Parent Phone', 'Resize Class', 'Resize Subjects', 'Resize Payment Receipt', 'Resize Registered']);
    expect(handle('Subjects').getAttribute('aria-valuenow')).toBe(String(DEFAULT.subjects.width));
  });

  it('long text ends in "…" with the full text on hover', async () => {
    const table = await renderTable();
    const cell = within(table).getAllByText('English, Kiswahili')[0].closest('td');
    expect(cell.className).toMatch(/cell-clip/);
    expect(cell.getAttribute('title')).toBe('English, Kiswahili');
  });
});

describe('phones (under 768 px)', () => {
  it('no handles and no fixed widths: the table as today', async () => {
    setWide(false);
    const table = await renderTable();
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
    expect(table.querySelector('colgroup')).toBeNull();
    expect(table.className).not.toMatch(/student-table-fixed/);
  });
});

describe('performance', () => {
  it('a resize does not re-render the rows', async () => {
    const { default: StudentRow } = await import('@features/dashboard/components/StudentRow');
    void StudentRow;
    const hl = await import('@features/dashboard/search/highlightMatches');
    const spy = vi.spyOn(hl, 'highlightMatches');
    await renderTable();
    const before = spy.mock.calls.length;
    await act(async () => { fireEvent.keyDown(handle('Subjects'), { key: 'ArrowRight' }); });
    expect(spy.mock.calls.length).toBe(before);
  });
});
