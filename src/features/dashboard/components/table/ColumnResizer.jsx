import { useRef } from 'react';
import { clampWidth, MAX_WIDTH } from './studentColumns';

/**
 * A column's resize handle — 011Fixes / 02 (owner: adjustable like Excel).
 * Sits on the header's right edge. Drag with a mouse, pen or a tablet finger
 * (pointer events); while dragging only the <col> and the table's width are
 * changed directly, once per animation frame, so the rows never re-render.
 * The width is saved when the drag ends. Double-click: the default width.
 * Keyboard: ←/→ by 10 px, Shift for 40 px.
 */
export default function ColumnResizer({ column, width, onResize, onReset }) {
  const drag = useRef(null);

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const table = e.currentTarget.closest('table');
    const colEl = table?.querySelector(`col[data-col="${column.id}"]`);
    if (!table || !colEl) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const handle = e.currentTarget;
    handle.classList.add('is-dragging');
    const state = {
      startX: e.clientX, startWidth: width, width, frame: 0,
      tableWidth: parseFloat(table.style.width) || table.getBoundingClientRect().width,
    };
    drag.current = state;
    const paint = () => {
      state.frame = 0;
      colEl.style.width = `${state.width}px`;
      table.style.width = `${state.tableWidth - state.startWidth + state.width}px`;
      handle.setAttribute('aria-valuenow', String(state.width));
    };
    const move = (ev) => {
      state.width = clampWidth(column.id, state.startWidth + (ev.clientX - state.startX)) ?? state.width;
      if (!state.frame) state.frame = requestAnimationFrame(paint);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (state.frame) cancelAnimationFrame(state.frame);
      paint();
      handle.classList.remove('is-dragging');
      drag.current = null;
      if (state.width !== state.startWidth) onResize(column.id, state.width);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const onKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = (e.shiftKey ? 40 : 10) * (e.key === 'ArrowRight' ? 1 : -1);
    onResize(column.id, width + step);
  };

  return (
    <span
      className="col-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${column.label}`}
      aria-valuenow={width}
      aria-valuemin={column.minWidth}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => { e.stopPropagation(); onReset(column.id); }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    />
  );
}
