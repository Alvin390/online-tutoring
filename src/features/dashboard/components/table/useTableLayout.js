import { useCallback, useState } from 'react';
import {
  DEFAULT_LAYOUT, STUDENT_COLUMNS, clampWidth, readLayout, writeLayout, clearLayout,
} from './studentColumns';

const FIXED = new Set(STUDENT_COLUMNS.filter((c) => c.fixed).map((c) => c.id));

/**
 * The teacher's students-table layout on this device — 011Fixes / 00.
 * `layout` = { widths: { id: px }, hidden: [id] }. One localStorage read when
 * the table mounts; a write only when she changes something.
 */
export function useTableLayout() {
  const [layout, setLayout] = useState(readLayout);

  const update = useCallback((change) => {
    setLayout((prev) => {
      const next = change(prev);
      if (next === prev) return prev;
      writeLayout(next);
      return next;
    });
  }, []);

  const setWidth = useCallback((id, px) => update((prev) => {
    const w = clampWidth(id, px);
    if (w == null || prev.widths[id] === w) return prev;
    return { ...prev, widths: { ...prev.widths, [id]: w } };
  }), [update]);

  /** Back to the column's default width (double-click on its edge). */
  const resetWidth = useCallback((id) => update((prev) => {
    if (!(id in prev.widths)) return prev;
    const { [id]: _drop, ...widths } = prev.widths;
    return { ...prev, widths };
  }), [update]);

  const setHidden = useCallback((id, hide) => update((prev) => {
    if (FIXED.has(id) || !STUDENT_COLUMNS.some((c) => c.id === id)) return prev;
    const has = prev.hidden.includes(id);
    if (hide === has) return prev;
    return { ...prev, hidden: hide ? [...prev.hidden, id] : prev.hidden.filter((x) => x !== id) };
  }), [update]);

  const reset = useCallback(() => {
    clearLayout();
    setLayout(DEFAULT_LAYOUT);
  }, []);

  return { layout, setWidth, resetWidth, setHidden, reset };
}
