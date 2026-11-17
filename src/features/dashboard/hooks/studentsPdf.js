import { visibleColumns, DEFAULT_LAYOUT } from '../components/table/studentColumns';

const PAGE_MM = 190;

/** The all-sessions view's Session column: printed only, right after the name. */
const SESSION_COLUMN = { id: 'session', width: 1, currentWidth: 1, pdf: { label: 'Session', mm: 22, minMm: 18 } };

const CELLS = {
  select: (s, i) => i + 1,
  name: (s) => s.studentName ?? '—',
  session: (s, i, names) => names[s.__session] ?? s.__session ?? '—',
  admissionNumber: (s) => s.admissionNumber || '—',
  phone: (s) => s.parentPhone ?? '—',
  class: (s) => s.class ?? '—',
  subjects: (s) => s.subjects ?? '—',
  // Guarded: an unguarded .substring() on a missing receiptMessage threw
  // and broke the entire export, not just that one row.
  receipt: (s) => {
    const receipt = s.receiptMessage ?? '';
    return receipt.substring(0, 50) + (receipt.length > 50 ? '...' : '');
  },
  registered: (s) => s.registeredAt?.toDate?.().toLocaleDateString('en-GB') || 'N/A',
};
const CENTRED = new Set(['select', 'class', 'registered']);

/**
 * 011Fixes / 04: the printed columns and their widths in mm. The table's shown
 * columns in its order (Select becomes #, Action is never printed), Session
 * after the name in the all-sessions view. The page is shared out by each
 * column's `pdf.mm` scaled by how far it was widened or narrowed on screen;
 * a column that would fall under its `pdf.minMm` gets its minimum and the
 * rest share what is left. The widths add up to the page exactly.
 */
export function planPdfColumns(columns, { includeSession = false } = {}) {
  const printed = columns.filter((c) => c.pdf && CELLS[c.id]);
  if (includeSession) printed.splice(printed.findIndex((c) => c.id === 'name') + 1, 0, SESSION_COLUMN);

  const mm = new Map();
  let left = PAGE_MM;
  for (const c of printed.filter((col) => col.pdf.fixedMm)) {
    mm.set(c.id, c.pdf.mm);
    left -= c.pdf.mm;
  }
  const weight = (c) => (c.pdf.mm * (c.currentWidth ?? c.width)) / c.width;
  let free = printed.filter((c) => !c.pdf.fixedMm);
  for (;;) {
    const total = free.reduce((n, c) => n + weight(c), 0);
    const under = free.filter((c) => (left * weight(c)) / total < (c.pdf.minMm ?? 0));
    if (!under.length) {
      for (const c of free) mm.set(c.id, Math.round(((left * weight(c)) / total) * 100) / 100);
      break;
    }
    for (const c of under) {
      mm.set(c.id, c.pdf.minMm);
      left -= c.pdf.minMm;
    }
    free = free.filter((c) => !under.includes(c));
    if (!free.length) break;
  }
  // Rounding to 0.01 mm: the widest column takes the remainder.
  const widest = [...mm.entries()].reduce((a, b) => (b[1] > a[1] ? b : a));
  mm.set(widest[0], Math.round((widest[1] + PAGE_MM - [...mm.values()].reduce((n, x) => n + x, 0)) * 100) / 100);

  return printed.map((c) => ({ id: c.id, label: c.pdf.label, mm: mm.get(c.id), centred: CENTRED.has(c.id), cell: CELLS[c.id] }));
}

/**
 * Builds the "Student List" PDF for one session (dashboard export).
 *
 * jsPDF and jspdf-autotable are loaded ON DEMAND rather than imported at
 * module scope. Statically, jsPDF drags in html2canvas (197 KB) and its
 * canvas/DOM helpers (155 KB) — roughly 350 KB that every teacher downloaded
 * on every dashboard load to support a button most of them press rarely, if
 * ever.
 *
 * Kept apart from useDashboard so the document itself can be tested.
 *
 * 001Fixes / 06: an export of a filtered list names the filter under the
 * title (`subtitle`), and an all-sessions export adds a Session column
 * (`includeSession`, names from `sessionNames`). With neither, the document
 * is exactly what it always was.
 *
 * 011Fixes / 04: `columns` (the table's shown columns, from Export) chooses
 * what is printed and how wide; without it, today's columns.
 *
 * @returns {Promise<import('jspdf').jsPDF|null>} the finished document (not saved); null while the page reloads
 */
export async function buildStudentsPdf({
  sessionName,
  students,
  now = new Date(),
  subtitle = '',
  includeSession = false,
  sessionNames = {},
  columns = visibleColumns(DEFAULT_LAYOUT, { numbersOn: false }),
  // 008Fixes / 08: how the two libraries are loaded (a test passes the empty
  // result Vite gives while the page reloads onto a new version).
  loadLibraries = () => Promise.all([import('jspdf'), import('jspdf-autotable')]),
}) {
  const [jspdfModule, autoTableModule] = await loadLibraries();
  // 008Fixes / 08: an empty module means the page is reloading onto a new
  // version (chunkReload.js) — nothing to build; the teacher presses Export
  // again on the new page.
  if (!jspdfModule || !autoTableModule) return null;
  const { default: jsPDF } = jspdfModule;
  const { default: autoTable } = autoTableModule;

  // Create new PDF document
  const doc = new jsPDF();

  // Add title
  doc.setFontSize(18);
  doc.setTextColor(102, 126, 234);
  doc.text(`${sessionName} - Student List`, 14, 22);

  // Add the filter (if any), then the date
  doc.setFontSize(10);
  doc.setTextColor(100);
  const dateLine = subtitle ? 36 : 30;
  if (subtitle) doc.text(`Filtered: ${subtitle}`, 14, 30);
  doc.text(`Generated: ${now.toLocaleDateString('en-GB')} ${now.toLocaleTimeString('en-GB')}`, 14, dateLine);
  const tableTop = dateLine + 5;

  const plan = planPdfColumns(columns, { includeSession });
  const head = plan.map((c) => c.label);
  const tableData = students.map((student, index) => plan.map((c) => c.cell(student, index, sessionNames)));
  const columnStyles = Object.fromEntries(plan.map((c, i) => [i, { cellWidth: c.mm, ...(c.centred ? { halign: 'center' } : {}) }]));

  autoTable(doc, {
    head: [head],
    body: tableData,
    startY: tableTop,
    theme: 'striped',
    headStyles: {
      fillColor: [102, 126, 234],
      textColor: 255,
      fontSize: 10,
      fontStyle: 'bold',
      halign: 'center'
    },
    bodyStyles: {
      fontSize: 9,
      cellPadding: 3
    },
    columnStyles,
    margin: { top: tableTop },
    styles: {
      overflow: 'linebreak',
      cellPadding: 2,
      fontSize: 8
    }
  });

  // Add footer
  const pageCount = doc.internal.getNumberOfPages();
  doc.setFontSize(8);
  doc.setTextColor(150);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.text(
      `Page ${i} of ${pageCount} | Total Students: ${students.length}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  return doc;
}
