import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  STUDENT_COLUMNS, LAYOUT_KEY, MAX_WIDTH, visibleColumns, readLayout, writeLayout, DEFAULT_LAYOUT,
} from '@features/dashboard/components/table/studentColumns';
import { useTableLayout } from '@features/dashboard/components/table/useTableLayout';

/**
 * 011Fixes / 00 — one list of the students table's columns (the table, the
 * chooser and the PDF read it), and the teacher's layout remembered on this
 * device (owner: per device): widths and hidden columns. A blocked or broken
 * store falls back to the defaults.
 */

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

const ids = (cols) => cols.map((c) => c.id);

describe('the column list', () => {
  it('in the table\'s order, with Admission No. after Student Name; Select, Student Name and Action always shown', () => {
    expect(ids(STUDENT_COLUMNS)).toEqual(['select', 'name', 'admissionNumber', 'phone', 'class', 'subjects', 'receipt', 'registered', 'action']);
    expect(ids(STUDENT_COLUMNS.filter((c) => c.fixed))).toEqual(['select', 'name', 'action']);
    for (const c of STUDENT_COLUMNS) expect(c.minWidth).toBeLessThanOrEqual(c.width);
  });

  it('shown columns: all by default; Admission No. only with admission numbers on; hidden ones left out, fixed ones never', () => {
    expect(ids(visibleColumns(DEFAULT_LAYOUT, { numbersOn: true }))).toEqual(ids(STUDENT_COLUMNS));
    expect(ids(visibleColumns(DEFAULT_LAYOUT, { numbersOn: false }))).not.toContain('admissionNumber');
    const layout = { ...DEFAULT_LAYOUT, hidden: ['subjects', 'receipt', 'name'] };
    expect(ids(visibleColumns(layout, { numbersOn: true }))).toEqual(['select', 'name', 'admissionNumber', 'phone', 'class', 'registered', 'action']);
  });
});

describe('remembered on this device', () => {
  it('nothing saved: the defaults', () => {
    expect(readLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('written and read back; unknown ids and bad widths dropped; widths clamped', () => {
    writeLayout({ widths: { subjects: 300, nonsense: 50 }, hidden: ['class', 'nonsense', 'name'] });
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY))).toMatchObject({ v: 1 });
    expect(readLayout()).toEqual({ widths: { subjects: 300 }, hidden: ['class'] });
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ v: 1, widths: { subjects: 5, phone: 99999, class: 'wide' }, hidden: [] }));
    const minSubjects = STUDENT_COLUMNS.find((c) => c.id === 'subjects').minWidth;
    expect(readLayout().widths).toEqual({ subjects: minSubjects, phone: MAX_WIDTH });
  });

  it('broken data or another version: the defaults', () => {
    localStorage.setItem(LAYOUT_KEY, '{not json');
    expect(readLayout()).toEqual(DEFAULT_LAYOUT);
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ v: 9, widths: { subjects: 300 }, hidden: ['class'] }));
    expect(readLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('a blocked store (private window, blocked site data): the defaults, and writing does not throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readLayout()).toEqual(DEFAULT_LAYOUT);
    expect(() => writeLayout({ widths: { subjects: 300 }, hidden: [] })).not.toThrow();
  });
});

describe('useTableLayout', () => {
  it('set a width, hide and show a column, kept after a remount; reset', () => {
    const first = renderHook(() => useTableLayout());
    act(() => first.result.current.setWidth('subjects', 320));
    act(() => first.result.current.setHidden('receipt', true));
    act(() => first.result.current.setHidden('name', true)); // fixed: ignored
    expect(first.result.current.layout).toEqual({ widths: { subjects: 320 }, hidden: ['receipt'] });
    first.unmount();

    const again = renderHook(() => useTableLayout());
    expect(again.result.current.layout).toEqual({ widths: { subjects: 320 }, hidden: ['receipt'] });
    act(() => again.result.current.setHidden('receipt', false));
    expect(again.result.current.layout.hidden).toEqual([]);
    act(() => again.result.current.reset());
    expect(again.result.current.layout).toEqual(DEFAULT_LAYOUT);
    expect(localStorage.getItem(LAYOUT_KEY)).toBeNull();
  });

  it('widths are clamped to the column\'s minimum and the maximum', () => {
    const { result } = renderHook(() => useTableLayout());
    act(() => result.current.setWidth('class', 1));
    act(() => result.current.setWidth('phone', 5000));
    expect(result.current.layout.widths).toEqual({ class: STUDENT_COLUMNS.find((c) => c.id === 'class').minWidth, phone: MAX_WIDTH });
  });
});
