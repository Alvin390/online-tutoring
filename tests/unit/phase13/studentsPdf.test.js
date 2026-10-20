import { describe, it, expect } from 'vitest';
import { buildStudentsPdf } from '@/features/dashboard/hooks/studentsPdf';

/**
 * The dashboard's "Export PDF". Pinned when jsPDF went from 3 to 4 (security
 * advisories): the document must still build, paginate and carry its rows.
 */

const student = (i, extra = {}) => ({
  studentName: `Student ${i}`,
  parentPhone: `+2547110000${String(i).padStart(2, '0')}`,
  class: 'Form Two',
  subjects: 'Mathematics',
  receiptMessage: `QAB${i}XYZ9 Confirmed`,
  registeredAt: { toDate: () => new Date('2026-10-05T08:00:00Z') },
  ...extra,
});

describe('buildStudentsPdf', () => {
  it('builds a multi-page PDF with the title, every row and a footer on each page', async () => {
    const students = Array.from({ length: 60 }, (_, i) => student(i + 1));
    students[3] = student(4, { receiptMessage: undefined });          // a missing receipt must not break it
    students[4] = student(5, { receiptMessage: 'R'.repeat(80) });     // truncated to 50 + '...'

    const doc = await buildStudentsPdf({ sessionName: 'Morning Session', students });
    const pages = doc.internal.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);

    const pdf = doc.output();
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toContain('Morning Session - Student List');
    expect(pdf).toContain('Student 1');
    expect(pdf).toContain('Student 60');
    // The receipt cell wraps over lines, so count its R's across the runs.
    const rs = (pdf.match(/R{3,}/g) ?? []).reduce((n, run) => n + run.length, 0);
    expect(rs).toBe(50);
    expect(pdf).toMatch(/R+\.\.\./);
    for (let i = 1; i <= pages; i++) {
      expect(pdf).toContain(`Page ${i} of ${pages} | Total Students: 60`);
    }
  });
});
