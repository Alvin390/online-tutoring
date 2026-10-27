import { useState } from 'react';
import {
  setClassAlertRecipient, resetClassAlertRecipient, setClassAlertsEnabled, sendClassAlertTest,
} from '@services/api/reports';

/**
 * Superadmin → Notifications → Before-class reminders — 002Fixes / 09.
 *
 * The teacher is emailed 60 and 15 minutes before a class while students are
 * waiting for approval. Here: on/off, where the emails go (changeable without
 * a deploy, audited server-side; by default the teacher's login email), and a
 * test send. The email itself says it is automated and not to be replied to.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE = {
  set: 'set here',
  teacher: "the teacher's login email (default)",
  report: 'the report address (no teacher account found)',
};

export default function ClassAlertsSettings({ initial, gmailConfigured }) {
  const [alerts, setAlerts] = useState(initial);
  const [address, setAddress] = useState(initial?.recipient ?? '');
  const [fieldError, setFieldError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn, done) => {
    setBusy(true);
    setStatus('');
    try {
      const res = await fn();
      if (res.classAlerts) {
        setAlerts(res.classAlerts);
        setAddress(res.classAlerts.recipient ?? '');
      }
      setStatus(done(res));
    } catch (err) {
      setStatus(err?.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const save = (e) => {
    e.preventDefault();
    const value = address.trim();
    if (!EMAIL.test(value)) {
      setFieldError('Enter a valid email address.');
      return;
    }
    setFieldError('');
    run(() => setClassAlertRecipient(value), (res) => `Saved. Reminders now go to ${res.classAlerts.recipients.join(', ')}.`);
  };

  if (!alerts) return null;
  const changed = address.trim().toLowerCase() !== (alerts.recipient ?? '');

  return (
    <div className="border-top pt-3 mt-3" data-testid="class-alerts">
      <div className="fw-semibold mb-1">Before-class reminders</div>
      <p className="small text-muted mb-2">
        Emails the teacher 60 and 15 minutes before a class while students are waiting for
        approval. Each email says it is automated and must not be replied to.
      </p>

      <div className="form-check form-switch mb-2">
        <input
          id="class-alerts-enabled"
          className="form-check-input"
          type="checkbox"
          role="switch"
          checked={alerts.enabled}
          disabled={busy}
          onChange={(e) => {
            const on = e.target.checked;
            run(() => setClassAlertsEnabled(on), () => (on ? 'Before-class reminders are on.' : 'Before-class reminders are off.'));
          }}
        />
        <label className="form-check-label" htmlFor="class-alerts-enabled">
          {alerts.enabled ? 'On' : 'Off'}
        </label>
      </div>

      <form onSubmit={save} noValidate className="mb-2" style={{ maxWidth: 520 }}>
        <label className="form-label small fw-semibold" htmlFor="class-alert-recipient">Send reminders to</label>
        <div className="d-flex gap-2">
          <input
            id="class-alert-recipient"
            type="email"
            className={`form-control${fieldError ? ' is-invalid' : ''}`}
            placeholder={alerts.recipients?.join(', ') || 'teacher@example.com'}
            value={address}
            onChange={(e) => { setAddress(e.target.value); setFieldError(''); }}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? 'class-alert-recipient-error' : 'class-alert-recipient-help'}
            autoComplete="email"
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !changed || !address.trim()}>Save</button>
        </div>
        {fieldError
          ? <div id="class-alert-recipient-error" className="invalid-feedback d-block">{fieldError}</div>
          : (
            <div id="class-alert-recipient-help" className="form-text" data-testid="class-alert-destination">
              Going to <strong>{alerts.recipients?.join(', ') || 'nobody yet'}</strong> — {SOURCE[alerts.source] ?? alerts.source}.
            </div>
          )}
      </form>

      <div className="d-flex align-items-center gap-2 flex-wrap">
        {alerts.source === 'set' && (
          <button
            type="button"
            className="btn btn-link btn-sm px-0"
            disabled={busy}
            onClick={() => run(resetClassAlertRecipient, (res) => `Reminders now go to ${res.classAlerts.recipients.join(', ')}.`)}
          >
            Use the teacher&apos;s login email
          </button>
        )}
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={busy || !gmailConfigured}
          onClick={() => run(sendClassAlertTest, (res) => res.message ?? (res.sent ? 'Test reminder sent.' : 'Test reminder failed.'))}
        >
          <i className="bi bi-send me-1" aria-hidden="true" />Send test reminder
        </button>
        {status && <span className="small" role="status">{status}</span>}
      </div>
    </div>
  );
}
