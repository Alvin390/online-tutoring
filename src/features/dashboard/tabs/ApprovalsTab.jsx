import { lazy, Suspense } from 'react';
import PendingApprovalsPanel from '../components/PendingApprovalsPanel';
import { useFlag } from '@shared/config/FlagsContext';

// 008Fixes / 05: codes the students are waiting for (read when opened).
const WaitingCodesPanel = lazy(() => import('../components/admission/WaitingCodesPanel'));
// 009Fixes / 04: numbers students changed themselves (from the rosters held).
const NumberFixesPanel = lazy(() => import('../components/admission/NumberFixesPanel'));

/**
 * Approvals — 007Fixes / 03. Its own lazy chunk; the panel itself is unchanged
 * (pre-class banners, Approve all, duplicates). Only shown when
 * `registration.requireApproval` is on.
 */
export default function ApprovalsTab({ pending, rosters, onApprove, onReject, loading, sessions, onOpenStudent }) {
  const numbers = useFlag('checkin.admissionNumbers');
  const sessionNames = Object.fromEntries((sessions ?? []).map((s) => [s.id, s.name ?? s.id]));
  return (
    <>
      {numbers && (
        <Suspense fallback={null}>
          <WaitingCodesPanel sessionNames={sessionNames} />
        </Suspense>
      )}
      {numbers && (
        <Suspense fallback={null}>
          <NumberFixesPanel rosters={rosters} sessionNames={sessionNames} onOpen={onOpenStudent} />
        </Suspense>
      )}
      <PendingApprovalsPanel
        pending={pending}
        rosters={rosters}
        onApprove={onApprove}
        onReject={onReject}
        loading={loading}
        sessions={sessions}
      />
    </>
  );
}
