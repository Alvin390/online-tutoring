import { useEffect, useState } from 'react';
import { getNotificationSettings, sendTestEmail, setReportRecipient } from '@services/api/reports';
import ClassAlertsSettings from './ClassAlertsSettings';

/**
 * Superadmin Settings → Notifications — Phase 13 / 06 D7.
 *
 * Where report alerts go (changeable without a deploy; audited server-side),
 * a test send, and the Gmail connection's health. "Disconnected" means Google
 * refused the refresh token: re-run `npm run gmail:auth` (appendix C, step 5).
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'never');

export default function NotificationsSettingsCard() {
  const [settings, setSettings] = useState(null);
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => getNotificationSettings()
    .then((res) => { setSettings(res); setRecipient(res.reportRecipient ?? ''); })
    .catch((err) => setError(err?.message ?? 'Could not load the settings.'));

  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setStatus('');
    const value = recipient.trim();
    if (!EMAIL.test(value)) {
      setFieldError('Enter a valid email address.');
      return;
    }
    setFieldError('');
    setBusy(true);
    try {
      const res = await setReportRecipient(value);
      setSettings((s) => ({ ...s, reportRecipient: res.reportRecipient }));
      setRecipient(res.reportRecipient);
      setStatus(`Saved. Reports now go to ${res.reportRecipient}.`);
    } catch (err) {
      setFieldError(err?.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setStatus('');
    try {
      const res = await sendTestEmail();
      setStatus(res.message ?? (res.sent ? 'Test email sent.' : 'Test email failed.'));
      await load();
    } catch (err) {
      setStatus(err?.message ?? 'Test email failed.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!settings) return <div className="card"><div className="card-body text-muted small">Loading…</div></div>;

  const gmail = settings.gmail ?? {};
  const changed = recipient.trim().toLowerCase() !== (settings.reportRecipient ?? '');

  return (
    <div className="card" data-testid="notifications-card">
      <div className="card-body">
        <h2 className="h5 fw-bold mb-3"><i className="bi bi-envelope me-2" aria-hidden="true" />Notifications</h2>

        <form onSubmit={save} noValidate className="mb-3" style={{ maxWidth: 520 }}>
          <label className="form-label fw-semibold" htmlFor="report-recipient">Send reports to</label>
          <div className="d-flex gap-2">
            <input
              id="report-recipient"
              type="email"
              className={`form-control${fieldError ? ' is-invalid' : ''}`}
              value={recipient}
              onChange={(e) => { setRecipient(e.target.value); setFieldError(''); }}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? 'report-recipient-error' : 'report-recipient-help'}
              autoComplete="email"
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !changed}>Save</button>
          </div>
          {fieldError
            ? <div id="report-recipient-error" className="invalid-feedback d-block">{fieldError}</div>
            : <div id="report-recipient-help" className="form-text">Bug reports and feature requests are emailed here.</div>}
        </form>

        <div className="d-flex align-items-center gap-2 flex-wrap mb-3">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={test} disabled={busy || !gmail.configured}>
            <i className="bi bi-send me-1" aria-hidden="true" />Send test email
          </button>
          {status && <span className="small" role="status">{status}</span>}
        </div>

        <div className="small">
          <div className="fw-semibold mb-1">Gmail connection</div>
          {!gmail.configured ? (
            <div className="alert alert-warning py-2 mb-0">
              Email is not set up — the GMAIL_* secrets are missing. Reports are still saved; only the email is skipped.
            </div>
          ) : gmail.disconnected ? (
            <div className="alert alert-danger py-2 mb-0" data-testid="gmail-disconnected">
              <strong>Gmail disconnected — reconnect.</strong> Google refused the saved token
              {gmail.lastError ? ` (${gmail.lastError})` : ''}. Run <code>npm run gmail:auth</code>, update
              GMAIL_REFRESH_TOKEN, then press Resend on any undelivered report.
            </div>
          ) : (
            <ul className="list-unstyled mb-0 text-muted">
              <li>Sending as {gmail.sender}</li>
              <li>Last successful send: {when(gmail.lastSuccessAt)}</li>
              <li>Last verified: {when(gmail.lastTokenCheckAt)}</li>
              {gmail.lastError && <li className="text-danger">Last error: {gmail.lastError}</li>}
            </ul>
          )}
        </div>

        {/* 002Fixes / 09: where before-class reminders go, on/off, and a test. */}
        <ClassAlertsSettings initial={settings.classAlerts} gmailConfigured={Boolean(gmail.configured)} />
      </div>
    </div>
  );
}
