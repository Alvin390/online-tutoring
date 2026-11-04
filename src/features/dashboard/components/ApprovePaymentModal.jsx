import { useId, useMemo, useState } from 'react';
import Modal from '@components/ui/Modal';
import { formatKes } from '@utils/blockReason';
import { mpesaCode } from '@utils/duplicates';
import { receiptKes } from '../bulk/receiptAmount';

/**
 * Approving a receipt from someone who owes — 006Fixes / 06 (owner, 4 Nov
 * 2026). Complete records everything owed; Partial records the amount typed
 * and leaves the rest owing (still in Total outstanding, and listed under the
 * "Partial payment" filter). Either way the student is approved and let in.
 * A lazy chunk: loaded on the first Approve of someone who owes.
 */
export default function ApprovePaymentModal({ studentName, sessionName, receipt, owed, onConfirm, onClose }) {
  const id = useId();
  const fromReceipt = useMemo(() => receiptKes(receipt), [receipt]);
  const code = useMemo(() => mpesaCode(receipt), [receipt]);
  const [payment, setPayment] = useState('full');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const choosePartial = () => {
    setPayment('partial');
    if (typed === '' && fromReceipt && fromReceipt < owed) setTyped(String(fromReceipt));
  };

  const amount = /^\d+$/.test(typed.trim()) ? Number(typed.trim()) : NaN;
  let problem = null;
  if (payment === 'partial') {
    if (!Number.isInteger(amount) || amount < 1) problem = typed.trim() === '' ? 'Enter the amount paid.' : 'Enter the amount paid, in whole shillings.';
    else if (amount >= owed) problem = `For the full ${formatKes(owed)}, choose Complete payment.`;
  }
  const label = payment === 'full'
    ? `Approve: record ${formatKes(owed)}`
    : `Approve: record ${Number.isInteger(amount) && amount > 0 ? formatKes(amount) : 'KES …'} (partial)`;

  const confirm = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      await onConfirm(payment === 'full' ? { payment: 'full' } : { payment: 'partial', amount });
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="btn btn-success" onClick={confirm} disabled={Boolean(problem) || busy}>{label}</button>
    </>
  );

  return (
    <Modal title={`Approve ${studentName}'s receipt${sessionName ? ` (${sessionName})` : ''}`} onClose={busy ? () => {} : onClose} footer={footer}>
      <div className="small mb-2 approve-receipt-text" data-testid="approve-receipt">{receipt || 'No receipt text.'}</div>
      {code && <div className="small text-muted mb-2" data-testid="approve-code">M-Pesa code: <code>{code}</code></div>}
      <p className="fw-semibold mb-2" data-testid="approve-owed">Owes {formatKes(owed)}.</p>

      <div className="d-grid gap-2 mb-2" role="radiogroup" aria-label="How much was paid">
        <label className={`approve-choice border rounded p-2 ${payment === 'full' ? 'border-success bg-success bg-opacity-10' : ''}`}>
          <input type="radio" className="form-check-input me-2" name={`${id}-payment`} checked={payment === 'full'} onChange={() => setPayment('full')} />
          <strong>Complete payment</strong>
          <div className="small text-muted ms-4">Records {formatKes(owed)} as paid. Balance becomes 0.</div>
        </label>
        <label className={`approve-choice border rounded p-2 ${payment === 'partial' ? 'border-warning bg-warning bg-opacity-10' : ''}`}>
          <input type="radio" className="form-check-input me-2" name={`${id}-payment`} checked={payment === 'partial'} onChange={choosePartial} />
          <strong>Partial payment</strong>
          <div className="small text-muted ms-4">Records what was paid. The rest stays owing.</div>
        </label>
      </div>

      {payment === 'full' && fromReceipt !== null && fromReceipt < owed && (
        <div className="alert alert-warning py-2 small mb-0" data-testid="approve-hint">
          The receipt says Ksh {fromReceipt.toLocaleString('en-KE')}, less than the {formatKes(owed)} owed.
        </div>
      )}

      {payment === 'partial' && (
        <div>
          <label htmlFor={`${id}-amount`} className="form-label small fw-semibold mb-1">Amount paid (KES)</label>
          <input
            id={`${id}-amount`}
            className={`form-control ${problem && typed !== '' ? 'is-invalid' : ''}`}
            inputMode="numeric"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {problem && typed !== '' && <div className="invalid-feedback d-block" data-testid="approve-error">{problem}</div>}
          {!problem && (
            <div className="small mt-1" data-testid="approve-remainder">
              Owes {formatKes(owed - amount)} after this. Counts in Total outstanding. Shows under Partial payment.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
