import { Link } from 'react-router-dom';
import FeeKpiCards from '@features/fees/components/FeeKpiCards';
import TierGate from '@shared/components/TierGate';
import { tabPath } from '../nav/dashboardTabs';

// 007Fixes / 05: the student list, already filtered, across every session (the
// figures above are for the whole school, not one session).
const studentsWith = (status) => `${tabPath('students')}?status=${status}&scope=all`;

/**
 * Fees — 007Fixes / 03. Its own lazy chunk (named so it never clashes with the
 * drawer's per-student FeesTab). The KPI listener (one aggregate document) now
 * runs only while this tab is open, instead of on every dashboard visit.
 * Silver, matching api/fees/*.js.
 *
 * 007Fixes / 05: shortcuts from the figures to the students behind them. No
 * new figures here; the "Collected" figure is backlog Issue 3.
 */
export default function FeesOverviewTab({ sessions, partial }) {
  return (
    <TierGate
      tier="silver"
      feature="Fee ledger and invoicing"
      description="Record payments, issue invoices and see who is behind"
    >
      {/* 004Fixes / 09: one line of money per active session. */}
      <FeeKpiCards sessions={sessions} partial={partial} />

      <div className="d-flex flex-wrap gap-2" data-testid="fees-shortcuts">
        <Link to={studentsWith('owes')} className="btn btn-outline-primary btn-sm">
          <i className="bi bi-person-exclamation me-1" aria-hidden="true" />See who owes →
        </Link>
        {partial?.count > 0 && (
          <Link to={studentsWith('partial')} className="btn btn-outline-secondary btn-sm">
            <i className="bi bi-pie-chart me-1" aria-hidden="true" />See partial payers →
          </Link>
        )}
      </div>
    </TierGate>
  );
}
