import { memo } from 'react';

/**
 * "Students 130 · Morning 70 · Evening 60 · Class links 2 of 2" — 007Fixes / 05.
 *
 * Replaces the four stats cards (Phase 10 D3) above the session tabs: the
 * same figures in one line that wraps on a phone, instead of a row of cards
 * that pushed the student list a screen down. Every session is counted (the
 * cards stopped at two), in the session tabs' order.
 */
function CountLine({ studentsBySession, sessions, totalCount, linksConfigured, linksTotal }) {
  const bySession = studentsBySession ?? {};
  const items = (sessions ?? []).map((s) => ({ key: s.id, label: s.name ?? s.id, value: bySession[s.id]?.length ?? 0 }));
  return (
    <p className="dashboard-count-line" data-testid="count-line">
      <span className="dashboard-count-total">
        <i className="bi bi-people-fill me-1" aria-hidden="true" />
        Students <strong>{totalCount ?? 0}</strong>
      </span>
      {items.map((item) => (
        <span key={item.key}>
          <span className="dashboard-count-sep" aria-hidden="true"> · </span>
          {item.label} <strong>{item.value}</strong>
        </span>
      ))}
      <span>
        <span className="dashboard-count-sep" aria-hidden="true"> · </span>
        Class links <strong>{linksConfigured ?? 0} of {linksTotal ?? items.length}</strong>
      </span>
    </p>
  );
}

export default memo(CountLine);
