import FeeKpiCards from '@features/fees/components/FeeKpiCards';
import TierGate from '@shared/components/TierGate';

/**
 * Fees — 007Fixes / 03. Its own lazy chunk (named so it never clashes with the
 * drawer's per-student FeesTab). The KPI listener (one aggregate document) now
 * runs only while this tab is open, instead of on every dashboard visit.
 * Silver, matching api/fees/*.js.
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
    </TierGate>
  );
}
