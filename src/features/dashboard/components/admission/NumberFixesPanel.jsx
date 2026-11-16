import { useMemo, useState } from 'react';

/**
 * Numbers changed by students — 009Fixes / 04 (owner, 2026-11-16). A student
 * whose phone was never confirmed may move their registration ONCE to their
 * real number (POST /api/student/fixNumber); the teacher sees who did, from
 * which number to which, and when, and can open the student to correct it.
 *
 * Built from the rosters the dashboard already holds (the move sets
 * `numberFixedAt` / `numberFixedFrom` on the record): no extra reads, nothing
 * new listens. Collapsed by default. Lazy, staff-only.
 */

const ending = (phone) => `…${String(phone ?? '').slice(-3)}`;
const millis = (v) => v?.toMillis?.() ?? (v?.toDate ? v.toDate().getTime() : (typeof v === 'number' ? v : Date.parse(v ?? '') || 0));
const when = (ms) => (ms ? new Date(ms).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function NumberFixesPanel({ rosters = {}, sessionNames = {}, onOpen }) {
  const [open, setOpen] = useState(false);
  const fixes = useMemo(() => Object.entries(rosters)
    .flatMap(([session, list]) => (list ?? [])
      .filter((s) => s.numberFixedAt && s.numberFixedFrom)
      .map((s) => ({ ...s, __session: session, at: millis(s.numberFixedAt) })))
    .sort((a, b) => b.at - a.at), [rosters]);

  return (
    <div className="card mb-3" data-testid="number-fixes">
      <div className="card-body py-2 d-flex align-items-center justify-content-between gap-2 flex-wrap">
        <div>
          <strong><i className="bi bi-telephone-forward me-2" aria-hidden="true" />Numbers changed by students ({fixes.length})</strong>
          <div className="small text-muted">Students who moved their registration to their real number (once each).</div>
        </div>
        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={fixes.length === 0}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && fixes.length > 0 && (
        <ul className="list-group list-group-flush">
          {fixes.map((s) => (
            <li key={`${s.__session}/${s.id ?? s.parentPhone}`} className="list-group-item d-flex justify-content-between align-items-center gap-2 flex-wrap" data-testid="number-fix">
              <div className="text-break">
                <div className="fw-semibold">
                  {s.studentName || 'No name'}
                  <span className="badge text-bg-light border ms-2 fw-normal">{sessionNames[s.__session] ?? s.__session}</span>
                </div>
                <div className="small text-muted">
                  <span className="font-monospace">{ending(s.numberFixedFrom)}</span>
                  <i className="bi bi-arrow-right mx-1" aria-hidden="true" />
                  <span className="font-monospace">{ending(s.id ?? s.parentPhone)}</span>
                  {s.at ? <> · {when(s.at)}</> : null}
                </div>
              </div>
              {onOpen && (
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onOpen(s)}>Open</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
