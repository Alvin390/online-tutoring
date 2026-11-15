import { useCallback, useEffect, useState } from 'react';
import { getSmsSummary, refreshSmsBalance, setSmsAlertRecipient, resetSmsAlertRecipient } from '@services/api/adminSms';

/**
 * Superadmin → SMS — 008Fixes / 10 (owner answers 6 and 8: track the spend,
 * alerts at 80% used and when the credit runs out; no cap).
 *
 * The wallet (balance in KES and SMS, used since the last top-up), the alerts
 * sent, usage per teacher (this month and in total), whether SMS is set up,
 * and where the credit alerts go. Reads once when opened; Refresh balance
 * asks HashBack once.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const kes = (v) => `KES ${Number(v ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export default function SmsCostCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const [recipient, setRecipient] = useState('');
  const [fieldError, setFieldError] = useState('');

  const apply = (res) => {
    setData(res);
    setRecipient(res.alerts?.source === 'sms' ? res.alerts.recipient : '');
  };

  const load = useCallback(() => getSmsSummary().then(apply).catch((err) => setError(err?.message || 'Could not load SMS.')), []);
  useEffect(() => { load(); }, [load]);

  const run = async (what, fn, done) => {
    setBusy(what);
    setStatus('');
    setError('');
    try {
      apply(await fn());
      if (done) setStatus(done);
    } catch (err) {
      setError(err?.message || 'That did not work. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const save = (e) => {
    e.preventDefault();
    const value = recipient.trim();
    if (!EMAIL.test(value)) { setFieldError('Enter a valid email address.'); return; }
    setFieldError('');
    run('save', () => setSmsAlertRecipient(value), `Saved. SMS credit alerts now go to ${value.toLowerCase()}.`);
  };

  if (!data) {
    return error
      ? <div className="alert alert-danger" role="alert">{error}</div>
      : <div className="text-muted small">Loading…</div>;
  }

  const b = data.balance;
  const used = b ? Math.round(b.usedFraction * 100) : 0;
  const barClass = used >= 80 ? 'bg-danger' : used >= 60 ? 'bg-warning' : 'bg-success';

  return (
    <div className="card" data-testid="sms-cost-card">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
          <div>
            <h2 className="h5 mb-1"><i className="bi bi-chat-text me-2" aria-hidden="true" />SMS</h2>
            <div className="small text-muted">
              {data.setup.unlocked
                ? <>Set up{data.setup.schoolName ? <> as <strong>{data.setup.schoolName}</strong></> : null} on {when(data.setup.unlockedAt)}{data.setup.unlockedByEmail ? ` by ${data.setup.unlockedByEmail}` : ''}.</>
                : 'Not set up yet: a teacher does it on the Messages tab (school name, then a test SMS).'}
            </div>
          </div>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => run('refresh', refreshSmsBalance, 'Balance checked with HashBack.')} disabled={Boolean(busy)}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />{busy === 'refresh' ? 'Checking…' : 'Refresh balance'}
          </button>
        </div>

        {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
        {status && <div className="alert alert-success small py-2" role="status">{status}</div>}

        {b ? (
          <div className="mb-4" data-testid="sms-wallet">
            <div className="d-flex flex-wrap align-items-baseline gap-3">
              <span className="fs-4 fw-semibold">{kes(b.balance)}</span>
              <span className="text-muted">about {b.units.toLocaleString('en-KE')} SMS at {kes(data.rate)} each</span>
            </div>
            <div className="progress mt-2" style={{ height: 10 }} role="progressbar" aria-label="Used since the last top-up" aria-valuenow={used} aria-valuemin={0} aria-valuemax={100}>
              <div className={`progress-bar ${barClass}`} style={{ width: `${used}%` }} />
            </div>
            <div className="small text-muted mt-1">
              {used}% used of {kes(b.fullAt)} since the last top-up{b.topUpAt ? ` (${when(b.topUpAt)})` : ''} · checked {when(b.at)}
            </div>
            <div className="small text-muted">Bulk SMS stops at {kes(data.reserve)} so check-in codes keep working.</div>
            <ul className="small mb-0 mt-2 ps-3" data-testid="sms-alerts">
              <li>{Math.round(data.alerts.usedThreshold * 100)}% used alert: {b.alerted80At ? `sent ${when(b.alerted80At)}` : 'not sent since the last top-up'}</li>
              <li>No credit alert: {b.alertedEmptyAt ? `sent ${when(b.alertedEmptyAt)}` : 'not sent since the last top-up'}</li>
            </ul>
          </div>
        ) : (
          <p className="text-muted small mb-4">No balance seen yet. Press Refresh balance, or it appears after the first SMS.</p>
        )}

        <h3 className="h6">By teacher</h3>
        {data.usage.length === 0 ? (
          <p className="text-muted small">No SMS sent yet.</p>
        ) : (
          <div className="table-responsive mb-4">
            <table className="table table-sm align-middle mb-0" data-testid="sms-usage">
              <thead>
                <tr><th scope="col">Teacher</th><th scope="col" className="text-end">This month</th><th scope="col" className="text-end">Total</th><th scope="col">Last SMS</th></tr>
              </thead>
              <tbody>
                {data.usage.map((t) => (
                  <tr key={t.uid}>
                    <td className="text-break">{t.email ?? 'Unknown account'}</td>
                    <td className="text-end text-nowrap">{t.monthUnits} SMS · {kes(t.monthCost)}</td>
                    <td className="text-end text-nowrap">{t.units} SMS · {kes(t.cost)}</td>
                    <td className="small text-muted text-nowrap">{when(t.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
              {data.usage.length > 1 && (
                <tfoot>
                  <tr className="fw-semibold"><td>All</td><td className="text-end text-nowrap">{data.totals.monthUnits} SMS · {kes(data.totals.monthCost)}</td><td className="text-end text-nowrap">{data.totals.units} SMS · {kes(data.totals.cost)}</td><td /></tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        <h3 className="h6">Credit alerts go to</h3>
        <p className="small text-muted mb-2">
          Now: <strong>{data.alerts.recipient ?? 'nobody'}</strong>
          {data.alerts.source === 'report' ? ' (the report recipient, until you set one here)' : ''}.
        </p>
        <form className="d-flex flex-wrap gap-2 align-items-start" onSubmit={save} noValidate>
          <div style={{ minWidth: 240, flex: '1 1 240px', maxWidth: 360 }}>
            <label className="visually-hidden" htmlFor="sms-alert-recipient">Email for SMS credit alerts</label>
            <input id="sms-alert-recipient" type="email" className={`form-control form-control-sm ${fieldError ? 'is-invalid' : ''}`}
              placeholder="name@example.com" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            {fieldError && <div className="invalid-feedback">{fieldError}</div>}
          </div>
          <button type="submit" className="btn btn-sm btn-primary" disabled={Boolean(busy)}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          {data.alerts.source === 'sms' && (
            <button type="button" className="btn btn-sm btn-link" disabled={Boolean(busy)}
              onClick={() => run('reset', resetSmsAlertRecipient, 'SMS credit alerts go to the report recipient again.')}>
              Use the report recipient
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
