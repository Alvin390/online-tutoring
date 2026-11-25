import { useEffect, useState } from 'react';
import Modal from '@shared/components/ui/Modal';
import { TIER_ORDER, TIERS } from '@shared/constants/tiers';
import { getBillingSettings, startSchoolTrial } from '@services/api/adminBilling';
import { formatNairobi } from '@/features/billing/planEnd';

/**
 * Superadmin "Start trial" — 013Fixes / 19 (owner answer 6). The package, the
 * length (the billing setting by default) and, optionally, a payment recorded
 * with the trial (amount, method, M-Pesa code, note). Then a confirmation in
 * plain words: "Start a 14-day Gold trial ending 3 December 2026, 5:00 pm?"
 */

const METHODS = [
  { id: 'mpesa', label: 'M-Pesa' },
  { id: 'cash', label: 'Cash' },
  { id: 'bank', label: 'Bank' },
];
const DAY_MS = 24 * 60 * 60 * 1000;

export default function StartTrialModal({ currentTier = 'gold', onClose, onStarted }) {
  const [tier, setTier] = useState(TIER_ORDER.includes(currentTier) ? currentTier : 'gold');
  const [days, setDays] = useState('');
  const [withPayment, setWithPayment] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('mpesa');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    getBillingSettings()
      .then((res) => { if (live) setDays((d) => d || String(res.settings.trialDays)); })
      .catch(() => { if (live) setDays((d) => d || '14'); });
    return () => { live = false; };
  }, []);

  const dayCount = Number(days);
  const daysOk = Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= 90;
  const amountOk = !withPayment || (Number.isInteger(Number(amount)) && Number(amount) >= 1);
  const codeOk = !withPayment || method !== 'mpesa' || /^[A-Za-z0-9]{10}$/.test(code.trim());
  const ready = daysOk && amountOk && codeOk;
  const endsText = daysOk ? formatNairobi(Date.now() + dayCount * DAY_MS) : '';
  const question = `Start a ${dayCount}-day ${TIERS[tier].name} trial ending ${endsText}?`;

  const review = (e) => {
    e.preventDefault();
    setError('');
    if (!daysOk) { setError('Enter a trial length from 1 to 90 days.'); return; }
    if (!amountOk) { setError('Enter the amount paid, in whole shillings.'); return; }
    if (!codeOk) { setError('Enter the M-Pesa code (10 letters and numbers).'); return; }
    setConfirming(true);
  };

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const payment = withPayment
        ? { amountKes: Number(amount), method, ...(method === 'mpesa' ? { code: code.trim().toUpperCase() } : {}), ...(note.trim() ? { note: note.trim() } : {}) }
        : undefined;
      const res = await startSchoolTrial({ tier, days: dayCount, payment });
      onStarted?.(res);
    } catch (err) {
      setConfirming(false);
      setError(err?.message || 'Could not start the trial.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Start trial"
      onClose={busy ? () => {} : onClose}
      footer={confirming ? (
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={() => setConfirming(false)} disabled={busy}>Back</button>
          <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
            {busy ? 'Starting…' : 'Start trial'}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="start-trial-form" className="btn btn-primary" disabled={!ready}>Continue</button>
        </>
      )}
    >
      {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
      {confirming ? (
        <p className="mb-0" data-testid="start-trial-question">
          {question}
          {withPayment && (
            <span className="d-block small text-muted mt-2">
              With a payment recorded: KES {Number(amount).toLocaleString('en-KE')} by {METHODS.find((m) => m.id === method)?.label}.
            </span>
          )}
        </p>
      ) : (
        <form id="start-trial-form" onSubmit={review} noValidate>
          <div className="row g-3">
            <div className="col-sm-6">
              <label className="form-label small fw-semibold" htmlFor="trial-tier">Package</label>
              <select id="trial-tier" className="form-select" value={tier} onChange={(e) => setTier(e.target.value)}>
                {TIER_ORDER.map((t) => <option key={t} value={t}>{TIERS[t].name}</option>)}
              </select>
            </div>
            <div className="col-sm-6">
              <label className="form-label small fw-semibold" htmlFor="trial-days">Trial length (days)</label>
              <input id="trial-days" type="number" inputMode="numeric" min={1} max={90} step={1} className="form-control"
                value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
          </div>
          <div className="form-check mt-3">
            <input id="trial-with-payment" type="checkbox" className="form-check-input" checked={withPayment}
              onChange={(e) => setWithPayment(e.target.checked)} />
            <label className="form-check-label" htmlFor="trial-with-payment">Record a payment with this trial</label>
          </div>
          {withPayment && (
            <div className="row g-3 mt-1">
              <div className="col-sm-4">
                <label className="form-label small fw-semibold" htmlFor="trial-amount">Amount (KES)</label>
                <input id="trial-amount" type="number" inputMode="numeric" min={1} step={1} className="form-control"
                  value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="col-sm-4">
                <label className="form-label small fw-semibold" htmlFor="trial-method">Method</label>
                <select id="trial-method" className="form-select" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              {method === 'mpesa' && (
                <div className="col-sm-4">
                  <label className="form-label small fw-semibold" htmlFor="trial-code">M-Pesa code</label>
                  <input id="trial-code" type="text" autoCapitalize="characters" maxLength={10} className="form-control"
                    value={code} onChange={(e) => setCode(e.target.value)} placeholder="QAB1C2D3E4" />
                </div>
              )}
              <div className="col-12">
                <label className="form-label small fw-semibold" htmlFor="trial-note">Note (optional)</label>
                <input id="trial-note" type="text" maxLength={300} className="form-control"
                  value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Half of December" />
              </div>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
