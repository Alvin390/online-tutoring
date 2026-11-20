import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useOptionalBilling } from '../context/billingContextValue';
import { USAGE_WORDS, overallLevel } from './usageLevels';
import { ROUTES } from '@/routes/routeConfig';

const KEY = 'ot.usageNotice.v1';

/**
 * A small dashboard notice when the school is above an included allowance —
 * 013Fixes / 12. Dismissible; remembered on this device until the next count.
 * Never says locked or blocked: service continues.
 */
export default function UsageNotice() {
  const usage = useOptionalBilling()?.plan?.usage ?? null;
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  });
  if (!usage || overallLevel(usage) !== 'over') return null;
  if (dismissed && dismissed === String(usage.countedAt)) return null;

  const dismiss = () => {
    try { localStorage.setItem(KEY, String(usage.countedAt)); } catch { /* blocked storage: just hide now */ }
    setDismissed(String(usage.countedAt));
  };

  return (
    <div className="alert alert-warning d-flex justify-content-between align-items-center gap-2 small py-2" role="status" data-testid="usage-banner">
      <span>
        {USAGE_WORDS.over} <Link to={ROUTES.BILLING}>See usage</Link>
      </span>
      <button type="button" className="btn-close" aria-label="Dismiss" onClick={dismiss} />
    </div>
  );
}
