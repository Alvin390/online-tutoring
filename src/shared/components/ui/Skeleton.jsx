/**
 * Skeleton primitives — Phase 10 D4.
 *
 * Replace bare spinners. A spinner says "something is happening"; a skeleton
 * says "a table with six columns is about to appear here", which is both faster
 * to perceive and — because the placeholder occupies the real height — prevents
 * the layout shift that a spinner-then-content swap causes.
 *
 * `prefers-reduced-motion` removes the shimmer and leaves a static block. The
 * animation is decorative, so there is nothing to lose by dropping it, and a
 * shimmering page is a genuine problem for vestibular users.
 *
 * `aria-hidden` throughout, with one `aria-busy` live region at the container:
 * announcing twelve placeholder cells individually is noise, not information.
 */

const shimmerStyles = `
@keyframes skeleton-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.skeleton-block {
  background: linear-gradient(90deg, #eceef1 25%, #f6f7f9 50%, #eceef1 75%);
  background-size: 800px 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
  border-radius: 4px;
}
@media (prefers-reduced-motion: reduce) {
  .skeleton-block { animation: none; background: #eceef1; }
}
`;

export function SkeletonStyles() {
  return <style>{shimmerStyles}</style>;
}

export function SkeletonLine({ width = '100%', height = 14, className = '' }) {
  return (
    <span
      className={`skeleton-block d-inline-block ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** Table placeholder sized to the real table, so nothing shifts on swap. */
export function SkeletonTable({ rows = 6, columns = 7 }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <SkeletonStyles />
      <span className="visually-hidden">Loading students…</span>

      <table className="table mb-0" aria-hidden="true">
        <thead>
          <tr>
            {Array.from({ length: columns }, (_, i) => (
              <th key={i}><SkeletonLine width="70%" height={12} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: columns }, (_, c) => (
                <td key={c} style={{ height: 56, verticalAlign: 'middle' }}>
                  <SkeletonLine width={c === 0 ? '85%' : '60%'} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonCards({ count = 4 }) {
  return (
    <div className="row g-3" role="status" aria-busy="true">
      <SkeletonStyles />
      <span className="visually-hidden">Loading…</span>
      {Array.from({ length: count }, (_, i) => (
        <div className="col-6 col-lg-3" key={i} aria-hidden="true">
          <div className="card">
            <div className="card-body">
              <SkeletonLine width="55%" height={12} className="mb-2" />
              <SkeletonLine width="40%" height={22} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({ rows = 4 }) {
  return (
    <div role="status" aria-busy="true">
      <SkeletonStyles />
      <span className="visually-hidden">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className="border rounded p-3 mb-2" key={i} aria-hidden="true">
          <SkeletonLine width="45%" className="mb-2" />
          <SkeletonLine width="80%" height={12} />
        </div>
      ))}
    </div>
  );
}

export default SkeletonTable;
