import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildStudentsPdf } from '@/features/dashboard/hooks/studentsPdf';
import { visibleColumns, DEFAULT_LAYOUT } from '@features/dashboard/components/table/studentColumns';

/**
 * 011Fixes / 04 (owner: "Yes, match the table"): the PDF export prints the
 * columns shown on screen, in the table's order. # and Student Name always;
 * Session in the all-sessions view; Admission No. when shown; the Select box
 * and the Action buttons are never printed. The 190 mm page width is shared
 * in proportion to the on-screen widths, each column at least its PDF minimum.
 */

vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));
const flags = vi.hoisted(() => ({ 'checkin.admissionNumbers': true }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => flags[k] === true }));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); flags['checkin.admissionNumbers'] = true; });
afterEach(() => cleanup());

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const kid = (n, over = {}) => ({
  id: `+2547110${String(n).padStart(5, '0')}`, studentName: `Student ${n}`, parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: 'Form 3', subjects: 'English, Kiswahili', receiptMessage: 'QAB123XYZ9 Confirmed', receiptStatus: 'approved',
  approvalStatus: 'approved', blocked: false, feeBalance: 0, registeredAt: at(Date.parse('2026-10-01T09:00:00+03:00')), ...over,
});

/** Builds with the real jsPDF and a spy in place of the table plug-in. */
async function tableOf(args) {
  const autoTable = vi.fn();
  await buildStudentsPdf({
    sessionName: 'Morning Session',
    students: [kid(1, { admissionNumber: '0042' }), kid(2)],
    ...args,
    loadLibraries: async () => [await import('jspdf'), { default: autoTable }],
  });
  const opts = autoTable.mock.calls[0][1];
  const widths = Object.values(opts.columnStyles).map((s) => s.cellWidth);
  return { head: opts.head[0], body: opts.body, widths, styles: opts.columnStyles };
}
const sum = (xs) => xs.reduce((n, x) => n + x, 0);
const layout = (over) => ({ ...DEFAULT_LAYOUT, ...over });

describe('which columns are printed', () => {
  it('no layout given: exactly today\'s columns', async () => {
    const { head, body } = await tableOf({});
    expect(head).toEqual(['#', 'Student Name', 'Parent Phone', 'Class', 'Subjects', 'Payment Receipt', 'Registered']);
    expect(body[0]).toHaveLength(head.length);
  });

  it('the table\'s defaults with admission numbers on: Adm No. after the name, "—" when none; no Select, no Action', async () => {
    const { head, body } = await tableOf({ columns: visibleColumns(DEFAULT_LAYOUT, { numbersOn: true }) });
    expect(head).toEqual(['#', 'Student Name', 'Adm No.', 'Parent Phone', 'Class', 'Subjects', 'Payment Receipt', 'Registered']);
    expect(body[0].slice(0, 3)).toEqual([1, 'Student 1', '0042']);
    expect(body[1].slice(0, 3)).toEqual([2, 'Student 2', '—']);
  });

  it('hidden Subjects and Receipt are left out of the head and every row', async () => {
    const { head, body } = await tableOf({ columns: visibleColumns(layout({ hidden: ['subjects', 'receipt'] }), { numbersOn: true }) });
    expect(head).toEqual(['#', 'Student Name', 'Adm No.', 'Parent Phone', 'Class', 'Registered']);
    for (const row of body) expect(row).toHaveLength(6);
    expect(body[0]).toEqual([1, 'Student 1', '0042', kid(1).parentPhone, 'Form 3', '01/10/2026']);
  });

  it('the all-sessions view keeps Session, right after the name', async () => {
    const { head, body } = await tableOf({
      columns: visibleColumns(layout({ hidden: ['subjects'] }), { numbersOn: true }),
      includeSession: true,
      sessionNames: { morning: 'Morning Session' },
      students: [kid(1, { __session: 'morning', admissionNumber: '0042' })],
    });
    expect(head).toEqual(['#', 'Student Name', 'Session', 'Adm No.', 'Parent Phone', 'Class', 'Payment Receipt', 'Registered']);
    expect(body[0].slice(1, 4)).toEqual(['Student 1', 'Morning Session', '0042']);
  });

  it('the receipt is still cut to 50 characters', async () => {
    const { body } = await tableOf({ columns: visibleColumns(DEFAULT_LAYOUT, { numbersOn: false }), students: [kid(1, { receiptMessage: 'R'.repeat(80) })] });
    expect(body[0][5]).toBe(`${'R'.repeat(50)}...`);
  });
});

describe('the widths', () => {
  const cases = [
    ['no layout', {}],
    ['defaults, numbers on', { columns: visibleColumns(DEFAULT_LAYOUT, { numbersOn: true }) }],
    ['two hidden', { columns: visibleColumns(layout({ hidden: ['subjects', 'receipt'] }), { numbersOn: true }) }],
    ['all sessions', { columns: visibleColumns(DEFAULT_LAYOUT, { numbersOn: true }), includeSession: true }],
    ['only the fixed ones', { columns: visibleColumns(layout({ hidden: ['phone', 'class', 'subjects', 'receipt', 'registered'] }), { numbersOn: false }) }],
  ];
  it.each(cases)('%s: they fill the 190 mm page exactly; # stays 10 mm', async (_label, args) => {
    const { widths } = await tableOf(args);
    expect(sum(widths)).toBeCloseTo(190, 5);
    expect(widths[0]).toBe(10);
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(10);
  });

  it('a column widened on screen is wider in the PDF; the others share what is left', async () => {
    const base = await tableOf({ columns: visibleColumns(DEFAULT_LAYOUT, { numbersOn: false }) });
    const wide = await tableOf({ columns: visibleColumns(layout({ widths: { receipt: 500 } }), { numbersOn: false }) });
    const at = (t, label) => t.widths[t.head.indexOf(label)];
    expect(at(wide, 'Payment Receipt')).toBeGreaterThan(at(base, 'Payment Receipt') + 20);
    expect(at(wide, 'Parent Phone')).toBeLessThan(at(base, 'Parent Phone'));
    expect(sum(wide.widths)).toBeCloseTo(190, 5);
  });

  it('a column squeezed on screen keeps its PDF minimum (a phone number stays readable)', async () => {
    const { head, widths } = await tableOf({ columns: visibleColumns(layout({ widths: { phone: 110, receipt: 600, subjects: 600 } }), { numbersOn: true }) });
    expect(widths[head.indexOf('Parent Phone')]).toBeGreaterThanOrEqual(24);
    expect(widths[head.indexOf('Adm No.')]).toBeGreaterThanOrEqual(19); // "Adm No." on one line (14.5 mm + padding)
    expect(sum(widths)).toBeCloseTo(190, 5);
  });
});

describe('a real document', () => {
  it('carries the Adm No. header and the number', async () => {
    const doc = await buildStudentsPdf({
      sessionName: 'Morning Session',
      students: [kid(1, { admissionNumber: '4071' })],
      columns: visibleColumns(DEFAULT_LAYOUT, { numbersOn: true }),
    });
    const pdf = doc.output();
    expect(pdf).toContain('(Adm No.)');
    expect(pdf).toContain('(4071)');
  });
});

describe('Export from the table sends its columns', () => {
  async function renderPanel(onExport) {
    const { default: StudentSearchPanel } = await import('@features/dashboard/components/StudentSearchPanel.jsx');
    const noop = vi.fn();
    render(<MemoryRouter><StudentSearchPanel session="morning" sessionDoc={{ id: 'morning', name: 'Morning', classes: ['Form 3'] }}
      students={[kid(1, { admissionNumber: '0042' }), kid(2)]} loading={false} onDelete={noop} onEdit={noop} onExport={onExport}
      onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop} onView={noop} /></MemoryRouter>);
    await screen.findByRole('table');
  }

  it('the shown columns, in order, with this device\'s widths', async () => {
    localStorage.setItem('ot.studentTable.v1', JSON.stringify({ v: 1, widths: { receipt: 300 }, hidden: ['subjects'] }));
    const onExport = vi.fn();
    await renderPanel(onExport);
    fireEvent.click(screen.getByRole('button', { name: /Export to PDF/ }));
    const [session, view] = onExport.mock.calls[0];
    expect(session).toBe('morning');
    expect(view.columns.map((c) => c.id)).toEqual(['select', 'name', 'admissionNumber', 'phone', 'class', 'receipt', 'registered', 'action']);
    expect(view.columns.find((c) => c.id === 'receipt').currentWidth).toBe(300);
    // Nothing filtered: still the whole session (no students list, no subtitle).
    expect(view.students).toBeUndefined();
    expect(view.subtitle ?? '').toBe('');
  });
});
