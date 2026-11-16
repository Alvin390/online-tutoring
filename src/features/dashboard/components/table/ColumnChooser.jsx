import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STUDENT_COLUMNS } from './studentColumns';

/**
 * The column chooser — 011Fixes / 03 (owner: "a small setting in the table
 * header where the teacher can select what columns to be displayed").
 *
 * A small ⚙ button in the first header cell (always on screen, phones too)
 * opens a checklist. Select, Student Name and Action are listed ticked and
 * disabled (always shown). "Reset columns" puts widths and choices back.
 * The menu is portalled to <body> with a fixed position, so the table's
 * clipped header cells can't cut it off, and kept inside the screen.
 * Esc, a click outside, scrolling, or the button again closes it; focus goes
 * back to the button. Rendered only while open.
 */
const MENU_WIDTH = 240;

export default function ColumnChooser({ layout, numbersOn, onToggle, onReset }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const hidden = new Set(layout.hidden);
  const offered = STUDENT_COLUMNS.filter((c) => !c.needsNumbers || numbersOn);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  // Placed after a hidden first render, once its height is known: below the
  // button when it fits, otherwise above, and never off the screen (the
  // browser check at 1366 px found it running off the bottom).
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    if (!buttonRef.current || !menuRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const h = Math.min(menuRef.current.offsetHeight || 0, window.innerHeight - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8));
    const below = r.bottom + 6;
    const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, Math.min(r.top - 6 - h, window.innerHeight - 8 - h));
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      close(false);
    };
    // A scroll inside the menu keeps it; the page scrolling closes it.
    const onScroll = (e) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    menuRef.current?.querySelector('input:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-sm btn-link text-white p-0 ms-2 column-chooser-btn"
        aria-label="Choose columns"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Choose columns"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <i className="bi bi-gear" aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="dialog"
          aria-label="Columns"
          className="column-chooser card shadow"
          style={{
            position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, width: MENU_WIDTH, zIndex: 1080,
            maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', visibility: pos ? 'visible' : 'hidden',
          }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}
        >
          <div className="card-body p-3">
            <div className="fw-semibold mb-2">Columns</div>
            {offered.map((c) => (
              <label key={c.id} className="form-check d-flex align-items-center gap-2 mb-1">
                <input
                  type="checkbox"
                  className="form-check-input m-0"
                  checked={c.fixed || !hidden.has(c.id)}
                  disabled={Boolean(c.fixed)}
                  onChange={(e) => onToggle(c.id, !e.target.checked)}
                />
                <span className={c.fixed ? 'text-muted' : ''}>{c.label}</span>
              </label>
            ))}
            <div className="small text-muted mt-2">Hidden columns are still searched.</div>
            <button type="button" className="btn btn-sm btn-outline-secondary w-100 mt-2" onClick={() => { onReset(); close(); }}>
              <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />Reset columns
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
