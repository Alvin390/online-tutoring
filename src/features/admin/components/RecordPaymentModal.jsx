import { useState } from 'react';
import Modal from '@shared/components/ui/Modal';
import { TIER_ORDER, TIERS } from '@shared/constants/tiers';
import { recordSchoolPayment } from '@services/api/adminBilling';
import { formatNairobi } from '@/features/billing/planEnd';

/**
 * Superadmin "Record payment" — 013Fixes / 20 (owner answers 7 and 8; Q6:
 * always one calendar month). A school that paid the owner directly: the
 * package, amount, method, M-Pesa code and note. Continue asks the server
 * for the window first (nothing is written), then the confirmation says it
 * in plain words: "Record KES 5,000 by M-Pesa for Gold, covering 10 December
 * 2026, 9:00 am to 10 January 2027, 9:00 am?"
 */

const METHODS = [
  { id: 'mpesa', label: 'M-Pesa' },
  { id: 'cash', label: 'Cash' },
  { id: 'bank', label: 'Bank' },
];

export default function RecordPaymentModal({ currentTier = 'gold', prices = null, onClose, onRecorded }) {
  const [tier, setTier] = useState(TIER_ORDER.includes(currentTier) ? currentTier : 'gold');
  // 013Fixes / 27: the package's price (the server's), until typed over.
  const priceFor = (t) => (prices?.[t] != null ? String(prices[t]) : '');
  const [amount, setAmount] = useState(() => priceFor(TIER_ORDER.includes(currentTier) ? currentTier : 'gold'));
  const [amountTyped, setAmountTyped] = useState(false);
  const [method, setMethod] = useState('mpesa');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const amountOk = Number.isInteger(Number(amount)) && Number(amount) >= 1;
  const codeOk = method !== 'mpesa' || /^[A-Za-z0-9]{10}$/.test(code.trim());
  const ready = amountOk && codeOk;
  const methodLabel = METHODS.find((m) => m.id === method)?.label;

  const payment = () => ({
    tier,
    amountKes: Number(amount),
    method,
    ...(method === 'mpesa' ? { code: code.trim().toUpperCase() } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  });

  const review = async (e) => {
    e.preventDefault();
    setError('');
    if (!amountOk) { setError('Enter the amount paid, in whole shillings.'); return; }
    if (!codeOk) { setError('Enter the M-Pesa code (10 letters and numbers).'); return; }
    setBusy(true);
    try {
      const res = await recordSchoolPayment({ ...payment(), preview: true });
      setPreview(res.window);
    } catch (err) {
      setError(err?.message || 'Could not work out the period.');
    } finally {
      setBusy(false);
    }
  };

  const record = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await recordSchoolPayment(payment());
      onRecorded?.(res);
    } catch (err) {
      setPreview(null);
      setError(err?.message || 'Could not record the payment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Record payment"
      onClose={busy ? () => {} : onClose}
      footer={preview ? (
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={() => setPreview(null)} disabled={busy}>Back</button>
          <button type="button" className="btn btn-primary" onClick={record} disabled={busy}>
            {busy ? 'Recording…' : 'Record payment'}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="record-payment-form" className="btn btn-primary" disabled={!ready || busy}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </>
      )}
    >
      {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
      {preview ? (
        <div data-testid="record-payment-question">
          <p className="mb-2">
            Record KES {Number(amount).toLocaleString('en-KE')} by {methodLabel} for {TIERS[tier].name}, covering{' '}
            {formatNairobi(preview.from)} to {formatNairobi(preview.to)}?
          </p>
          <p className="small text-muted mb-0">
            {preview.startsNow
              ? 'It starts now: the school is open again straight away.'
              : 'It starts when the current period ends, so no days are lost.'}
          </p>
        </div>
      ) : (
        <form id="record-payment-form" onSubmit={review} noValidate>
          <div className="row g-3">
            <div className="col-sm-6">
              <label className="form-label small fw-semibold" htmlFor="pay-tier">Package</label>
              <select id="pay-tier" className="form-select" value={tier} onChange={(e) => { setTier(e.target.value); if (!amountTyped) setAmount(priceFor(e.target.value)); }}>
                {TIER_ORDER.map((t) => <option key={t} value={t}>{TIERS[t].name}</option>)}
              </select>
            </div>
            <div className="col-sm-6">
              <label className="form-label small fw-semibold" htmlFor="pay-amount">Amount (KES)</label>
              <input id="pay-amount" type="number" inputMode="numeric" min={1} step={1} className="form-control"
                value={amount} onChange={(e) => { setAmount(e.target.value); setAmountTyped(true); }} />
            </div>
            <div className="col-sm-6">
              <label className="form-label small fw-semibold" htmlFor="pay-method">Method</label>
              <select id="pay-method" className="form-select" value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            {method === 'mpesa' && (
              <div className="col-sm-6">
                <label className="form-label small fw-semibold" htmlFor="pay-code">M-Pesa code</label>
                <input id="pay-code" type="text" autoCapitalize="characters" maxLength={10} className="form-control"
                  value={code} onChange={(e) => setCode(e.target.value)} placeholder="QAB1C2D3E4" />
              </div>
            )}
            <div className="col-12">
              <label className="form-label small fw-semibold" htmlFor="pay-note">Note (optional)</label>
              <input id="pay-note" type="text" maxLength={300} className="form-control"
                value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <p className="small text-muted mt-3 mb-0">A payment covers one calendar month.</p>
        </form>
      )}
    </Modal>
  );
}
