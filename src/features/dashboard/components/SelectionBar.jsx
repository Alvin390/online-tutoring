import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The bar that appears while students are ticked — 003Fixes / 03.
 *
 * A lazy chunk: the dashboard loads it on the first tick (and prefetches it
 * when idle), so the table's first paint does not carry it. On phones it is
 * fixed to the bottom of the screen; the body gets room for it so the last
 * row is never hidden underneath.
 *
 * On phones it is rendered into <body>: the dashboard's animated containers
 * carry a CSS transform, which turns `position: fixed` into "fixed to that
 * container" — measured in Chromium, the bar sat 3,700 px down the page.
 */
const PHONE = '(max-width: 767.98px)';

function usePhone() {
  const [phone, setPhone] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(PHONE).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const query = window.matchMedia(PHONE);
    const onChange = () => setPhone(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return phone;
}

export const BULK_LABELS = {
  block: 'Block selected',
  unblock: 'Unblock selected',
  approveReceipts: 'Approve receipts',
  cancelSchedule: 'Cancel schedule',
};

export default function SelectionBar({ count, action = 'block', onAction, onClear, busy = false }) {
  const phone = usePhone();
  useEffect(() => {
    document.body.classList.add('has-selection-bar');
    return () => document.body.classList.remove('has-selection-bar');
  }, []);

  const bar = (
    <div
      className="selection-bar"
      role="region"
      aria-label="Selected students"
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClear(); }}
    >
      <span className="selection-bar-count fw-semibold" aria-live="polite">
        {count} selected
      </span>
      <div className="selection-bar-actions">
        <button
          type="button"
          className={`btn btn-sm ${action === 'block' ? 'btn-danger' : 'btn-primary'}`}
          onClick={onAction}
          disabled={!onAction || busy}
        >
          {BULK_LABELS[action] ?? BULK_LABELS.block}
        </button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClear} disabled={busy}>
          Clear
        </button>
      </div>
    </div>
  );
  return phone ? createPortal(bar, document.body) : bar;
}
