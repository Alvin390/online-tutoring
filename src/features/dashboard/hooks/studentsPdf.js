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
 * @returns {Promise<import('jspdf').jsPDF>} the finished document (not saved)
 */
export async function buildStudentsPdf({
  sessionName,
  students,
  now = new Date(),
  subtitle = '',
  includeSession = false,
  sessionNames = {},
}) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

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

  // Prepare table data
  const tableData = students.map((student, index) => {
    const regDate = student.registeredAt?.toDate?.()
      .toLocaleDateString('en-GB') || 'N/A';

    // Guarded: an unguarded .substring() on a missing receiptMessage threw
    // and broke the entire export, not just that one row.
    const receipt = student.receiptMessage ?? '';

    const sessionCell = includeSession
      ? [sessionNames[student.__session] ?? student.__session ?? '—']
      : [];
    return [
      index + 1,
      student.studentName ?? '—',
      ...sessionCell,
      student.parentPhone ?? '—',
      student.class ?? '—',
      student.subjects ?? '—',
      receipt.substring(0, 50) + (receipt.length > 50 ? '...' : ''),
      regDate
    ];
  });

  // Add table
  const head = includeSession
    ? ['#', 'Student Name', 'Session', 'Parent Phone', 'Class', 'Subjects', 'Payment Receipt', 'Registered']
    : ['#', 'Student Name', 'Parent Phone', 'Class', 'Subjects', 'Payment Receipt', 'Registered'];
  // The same 190 mm either way; the Session column takes room from the receipt.
  const columnStyles = includeSession
    ? {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 32 },
      2: { cellWidth: 22 },
      3: { cellWidth: 28 },
      4: { cellWidth: 15, halign: 'center' },
      5: { cellWidth: 28 },
      6: { cellWidth: 32 },
      7: { cellWidth: 23, halign: 'center' },
    }
    : {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 35 },
      2: { cellWidth: 30 },
      3: { cellWidth: 15, halign: 'center' },
      4: { cellWidth: 30 },
      5: { cellWidth: 45 },
      6: { cellWidth: 25, halign: 'center' },
    };

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
