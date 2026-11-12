import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { nextClassWindow } from '@utils/classTime';
import { tabPath } from './dashboardTabs';

const URGENT_MS = 30 * 60 * 1000;

/**
 * "5 students waiting for approval · Review →" — 007Fixes / 03.
 *
 * With the dashboard in tabs, the pending-approvals panel lives on its own
 * tab; a student waiting to be let into a class that is already running is
 * still the most time-sensitive thing on the screen, so every other tab
 * carries this line (owner, 2026-11-11). It reads the pending list the
 * dashboard already holds: no extra read. Amber inside 30 minutes of a class
 * that has students waiting, as the pre-class banner is.
 */
export default function WaitingBanner({ pending, sessions }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const count = pending?.length ?? 0;
  const urgent = useMemo(() => {
    if (!count) return false;
    const waitingIn = new Set(pending.map((p) => p.session));
    return (sessions ?? []).some((session) => {
      if (!waitingIn.has(session.id)) return false;
      const window = nextClassWindow(session.schedule, now);
      return Boolean(window) && window.start - now <= URGENT_MS;
    });
  }, [count, pending, sessions, now]);

  if (!count) return null;
  return (
    <div
      className={`dashboard-waiting-banner alert ${urgent ? 'alert-warning' : 'alert-info'} d-flex align-items-center justify-content-between gap-2 py-2 px-3 mb-3`}
      role="status"
      data-testid="waiting-banner"
    >
      <span>
        <i className="bi bi-hourglass-split me-2" aria-hidden="true" />
        <strong>{count} {count === 1 ? 'student' : 'students'} waiting</strong> for approval
      </span>
      <Link to={tabPath('approvals')} className="fw-semibold text-nowrap">
        Review <i className="bi bi-arrow-right" aria-hidden="true" />
      </Link>
    </div>
  );
}
