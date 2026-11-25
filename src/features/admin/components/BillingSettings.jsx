import { useEffect, useState } from 'react';
import { getBillingSettings, saveBillingSettings } from '@services/api/adminBilling';

/**
 * Billing settings — 013Fixes / 18 (superadmin, under Plans). The trial's
 * length, when the countdown starts before the end, and how long a card
 * renewal may take to arrive from Paystack before the school locks.
 * Saved values apply from the next status read and the hourly sweep.
 */

const FIELDS = [
  { key: 'trialDays', label: 'Trial length (days)', help: 'How long a new trial lasts.', min: 1, max: 90 },
  { key: 'countdownHours', label: 'Countdown (hours before the end)', help: 'When the red countdown starts. 48 = the last two days.', min: 1, max: 720 },
  { key: 'cardRenewalToleranceHours', label: 'Card renewal wait (hours)', help: "How long to wait for Paystack's renewal before locking. Not a grace period.", min: 0, max: 72 },
];

export default function BillingSettings() {
  const [values, setValues] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    getBillingSettings()
      .then((res) => { if (live) { setValues(res.settings); setSaved(res.settings); } })
      .catch((err) => { if (live) setError(err?.message || 'Could not load the billing settings.'); });
    return () => { live = false; };
  }, []);

  const changed = values && saved && FIELDS.some((f) => Number(values[f.key]) !== saved[f.key]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNote('');
    try {
      const res = await saveBillingSettings(Object.fromEntries(FIELDS.map((f) => [f.key, Number(values[f.key])])));
      setValues(res.settings);
      setSaved(res.settings);
      setNote('Saved. Schools follow the new settings within the hour.');
    } catch (err) {
      setError(err?.message || 'Could not save the billing settings.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mt-4" data-testid="billing-settings">
      <div className="card-body">
        <h2 className="h5 mb-1">Billing settings</h2>
        <p className="text-muted small mb-3">Trials and paid periods count down before their end, then the school locks.</p>
        {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
        {note && <div className="alert alert-success small py-2" role="status">{note}</div>}
        {!values ? (
          !error && <p className="small text-muted mb-0">Loading…</p>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="row g-3">
              {FIELDS.map((f) => (
                <div className="col-md-4" key={f.key}>
                  <label className="form-label small fw-semibold" htmlFor={`billing-${f.key}`}>{f.label}</label>
                  <input
                    id={`billing-${f.key}`}
                    type="number"
                    inputMode="numeric"
                    min={f.min}
                    max={f.max}
                    step={1}
                    className="form-control"
                    value={values[f.key]}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                  <div className="form-text">{f.help}</div>
                </div>
              ))}
            </div>
            <button type="submit" className="btn btn-primary mt-3" disabled={busy || !changed}>
              {busy ? 'Saving…' : 'Save billing settings'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
