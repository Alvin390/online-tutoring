import PendingApprovalsPanel from '../components/PendingApprovalsPanel';

/**
 * Approvals — 007Fixes / 03. Its own lazy chunk; the panel itself is unchanged
 * (pre-class banners, Approve all, duplicates). Only shown when
 * `registration.requireApproval` is on.
 */
export default function ApprovalsTab({ pending, rosters, onApprove, onReject, loading, sessions }) {
  return (
    <PendingApprovalsPanel
      pending={pending}
      rosters={rosters}
      onApprove={onApprove}
      onReject={onReject}
      loading={loading}
      sessions={sessions}
    />
  );
}
