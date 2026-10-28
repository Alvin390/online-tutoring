/**
 * First / Previous / Next / Last for the student table — 003Fixes / 02.
 * Only the table re-renders on a page change: the rows are already in memory.
 */
const BUTTONS = [
  { label: 'First page', icon: 'bi-chevron-bar-left', to: () => 0, atStart: true },
  { label: 'Previous page', icon: 'bi-chevron-left', to: (p) => p - 1, atStart: true },
  { label: 'Next page', icon: 'bi-chevron-right', to: (p) => p + 1, atStart: false },
  { label: 'Last page', icon: 'bi-chevron-bar-right', to: (_p, n) => n - 1, atStart: false },
];

export default function TablePager({ page, pageCount, onPage }) {
  const button = ({ label, icon, to, atStart }) => (
    <button
      key={label}
      type="button"
      className="btn btn-outline-secondary btn-sm table-pager-btn"
      aria-label={label}
      title={label}
      disabled={atStart ? page === 0 : page >= pageCount - 1}
      onClick={() => onPage(to(page, pageCount))}
    >
      <i className={`bi ${icon}`} aria-hidden="true" />
    </button>
  );

  return (
    <nav className="table-pager" aria-label="Student list pages">
      {BUTTONS.slice(0, 2).map(button)}
      <span className="table-pager-label small text-muted" data-testid="page-label" aria-current="page">
        Page <strong>{page + 1}</strong> of {pageCount}
      </span>
      {BUTTONS.slice(2).map(button)}
    </nav>
  );
}
