import { USAGE_ROWS, USAGE_WORDS, usageLevel, overallLevel, windowText } from './usageLevels';

/**
 * The plan's usage as bars — 013Fixes / 12. Used on the billing page and the
 * superadmin page. Counted about once a day (phase 11); never a lockout.
 */
export default function UsageBars({ usage, title = 'Usage' }) {
  if (!usage) return null;
  const level = overallLevel(usage);
  const loginsFull = (usage.limits?.logins ?? 0) > 0 && usage.logins >= usage.limits.logins;
  const counted = usage.countedAt
    ? new Date(usage.countedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
    : null;

  return (
    <div className="card mb-4" data-testid="usage-card">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-baseline flex-wrap gap-2 mb-2">
          <h2 className="h6 fw-bold mb-0">{title}</h2>
          <span className="small text-muted">{windowText(usage)}</span>
        </div>
        {USAGE_ROWS.map((row) => {
          const used = usage[row.key] ?? 0;
          const limit = usage.limits?.[row.key] ?? 0;
          const pct = usage.percent?.[row.key] ?? 0;
          const rowLevel = usageLevel(pct);
          const barClass = rowLevel === 'over' ? 'bg-danger' : rowLevel === 'near' ? 'bg-warning' : 'bg-success';
          return (
            <div className="mb-2" key={row.key} data-testid={`usage-${row.key}`}>
              <div className="d-flex justify-content-between small">
                <span>{row.label}</span>
                <span><strong>{used.toLocaleString('en-KE')}</strong> of {limit.toLocaleString('en-KE')}</span>
              </div>
              <div className="progress" style={{ height: 6 }} role="progressbar" aria-label={`${row.label}: ${used} of ${limit}`}
                aria-valuenow={Math.min(pct, 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className={`progress-bar ${barClass}`} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
            </div>
          );
        })}
        {level !== 'ok' && (
          <p className={`small mb-1 ${level === 'over' ? 'text-danger' : 'text-warning-emphasis'}`} data-testid="usage-notice">
            {USAGE_WORDS[level]}
          </p>
        )}
        {loginsFull && <p className="small mb-1 text-muted" data-testid="usage-logins-full">{USAGE_WORDS.loginsFull}</p>}
        {counted && <p className="small text-muted mb-0">Counted daily · last counted {counted}</p>}
      </div>
    </div>
  );
}
