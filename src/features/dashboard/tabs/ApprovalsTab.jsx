import { lazy, Suspense } from 'react';
import PendingApprovalsPanel from '../components/PendingApprovalsPanel';
import { useFlag } from '@shared/config/FlagsContext';

// 008Fixes / 05: codes the students are waiting for (read when opened).
const WaitingCodesPanel = lazy(() => import('../components/admission/WaitingCodesPanel'));

/**
 * Approvals — 007Fixes / 03. Its own lazy chunk; the panel itself is unchanged
 * (pre-class banners, Approve all, duplicates). Only shown when
 * `registration.requireApproval` is on.
 */
export default function ApprovalsTab({ pending, rosters, onApprove, onReject, loading, sessions }) {
  const numbers = useFlag('checkin.admissionNumbers');
  const sessionNames = Object.fromEntries((sessions ?? []).map((s) => [s.id, s.name ?? s.id]));
  return (
    <>
      {numbers && (
        <Suspense fallback={null}>
          <WaitingCodesPanel sessionNames={sessionNames} />
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
