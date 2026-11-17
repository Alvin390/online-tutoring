/**
 * The students table's columns — 011Fixes / 00 (owner, 2026-11-16: the table
 * was rigid; add Admission No., resizable columns, and a choice of columns).
 *
 * ONE list, read by the table, the column chooser and the PDF export, in the
 * table's order. `fixed` columns are always shown (the checkbox column, the
 * name, the actions). `needsNumbers`: only while admission numbers are on.
 * Widths in px: `width` is the default, `minWidth` the narrowest a drag may
 * make it. `pdf.mm` is the column's share of the PDF page at its default
 * width (011Fixes / 04: a column widened on screen gets a bigger share),
 * `pdf.minMm` the narrowest it is printed; `fixedMm`: always `mm`. No `pdf`:
 * never printed (the Action buttons).
 *
 * The teacher's layout (widths she dragged, columns she hid) is remembered on
 * this device only (owner: per device), in localStorage. Every read and write
 * is guarded: a blocked or broken store simply gives the defaults.
 */

export const LAYOUT_KEY = 'ot.studentTable.v1';
const LAYOUT_VERSION = 1;
export const MAX_WIDTH = 600;

export const STUDENT_COLUMNS = Object.freeze([
  // Defaults sum to 1290 px: the table area on a 1366 px laptop.
  { id: 'select', label: 'Select', width: 140, minWidth: 130, fixed: true, resizable: false, pdf: { label: '#', mm: 10, fixedMm: true } },
  { id: 'name', label: 'Student Name', width: 190, minWidth: 140, fixed: true, pdf: { label: 'Student Name', mm: 34, minMm: 25 } },
  { id: 'admissionNumber', label: 'Admission No.', width: 110, minWidth: 80, needsNumbers: true, pdf: { label: 'Adm No.', mm: 20, minMm: 19 } },
  { id: 'phone', label: 'Parent Phone', width: 140, minWidth: 110, pdf: { label: 'Parent Phone', mm: 28, minMm: 24 } },
  { id: 'class', label: 'Class', width: 90, minWidth: 70, pdf: { label: 'Class', mm: 15, minMm: 12 } },
  { id: 'subjects', label: 'Subjects', width: 160, minWidth: 100, pdf: { label: 'Subjects', mm: 30, minMm: 18 } },
  { id: 'receipt', label: 'Payment Receipt', width: 170, minWidth: 100, pdf: { label: 'Payment Receipt', mm: 45, minMm: 22 } },
  { id: 'registered', label: 'Registered', width: 160, minWidth: 110, pdf: { label: 'Registered', mm: 25, minMm: 20 } },
  { id: 'action', label: 'Action', width: 130, minWidth: 120, fixed: true, resizable: false },
].map(Object.freeze));

const BY_ID = new Map(STUDENT_COLUMNS.map((c) => [c.id, c]));

export const DEFAULT_LAYOUT = Object.freeze({ widths: Object.freeze({}), hidden: Object.freeze([]) });

/** A width kept within the column's minimum and MAX_WIDTH, or null when not a number. */
export function clampWidth(id, px) {
  const col = BY_ID.get(id);
  if (!col || typeof px !== 'number' || !Number.isFinite(px)) return null;
  return Math.round(Math.min(MAX_WIDTH, Math.max(col.minWidth, px)));
}

/** Only known columns, sensible widths, hideable ids; anything else dropped. */
function clean(raw) {
  const widths = {};
  for (const [id, px] of Object.entries(raw?.widths ?? {})) {
    const w = clampWidth(id, px);
    if (w != null) widths[id] = w;
  }
  const hidden = [...new Set(Array.isArray(raw?.hidden) ? raw.hidden : [])]
    .filter((id) => BY_ID.has(id) && !BY_ID.get(id).fixed);
  return { widths, hidden };
}

export function readLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null');
    if (saved?.v === LAYOUT_VERSION) return clean(saved);
  } catch { /* storage blocked or malformed */ }
  return DEFAULT_LAYOUT;
}

export function writeLayout(layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ v: LAYOUT_VERSION, ...clean(layout) }));
  } catch { /* storage blocked: the layout lasts for this visit */ }
}

export function clearLayout() {
  try { localStorage.removeItem(LAYOUT_KEY); } catch { /* storage blocked */ }
}

/** The columns to show, in order, each with its current width. */
export function visibleColumns(layout, { numbersOn = false } = {}) {
  const hidden = new Set(layout?.hidden ?? []);
  return STUDENT_COLUMNS
    .filter((c) => (!c.needsNumbers || numbersOn) && (c.fixed || !hidden.has(c.id)))
    .map((c) => ({ ...c, currentWidth: layout?.widths?.[c.id] ?? c.width }));
}
