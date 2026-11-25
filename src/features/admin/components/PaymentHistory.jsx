import { useCallback, useEffect, useState } from 'react';
import { listAllPayments, backfillPayments } from '@services/api/adminBilling';
import { amountText, methodLabel, paidOn, periodText, tierLabel } from '@/features/billing/payments/paymentFormat';

/**
 * Superadmin payments — 013Fixes / 21. Every payment, newest first, 20 a
 * page, with the M-Pesa code, the note and where it came from (recorded by
 * hand, or paid in the app). Below it, the one-off fill-in of older in-app
 * payments: a check first (counts only), then "Fill in".
 */

const SOURCE_LABELS = { manual: 'Recorded', paystack: 'In the app' };

export default function PaymentHistory() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [check, setCheck] = useState(null);
  const [filling, setFilling] = useState(false);

  const load = useCallback(async (after) => {
    setLoading(true);
    setError('');
    try {
      const res = await listAllPayments(after);
      setItems((prev) => (after ? [...prev, ...res.items] : res.items));
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err?.message || 'Could not load the payments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(null); }, [load]);

  const runCheck = async () => {
    setFilling(true);
    setError('');
    try { setCheck(await backfillPayments(false)); } catch (err) { setError(err?.message || 'Could not check.'); } finally { setFilling(false); }
  };

  const fillIn = async () => {
    setFilling(true);
    setError('');
    try {
      const res = await backfillPayments(true);
      setCheck({ ...res, missing: res.remaining });
      await load(null);
    } catch (err) {
      setError(err?.message || 'Could not fill in the payments.');
    } finally {
      setFilling(false);
    }
  };

  return (
    <div className="card mb-4">
      <div className="card-header">
        <h2 className="h5 mb-0"><i className="bi bi-receipt me-2" aria-hidden="true" />Payments</h2>
      </div>
      <div className="card-body">
        {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
        {!loading && items.length === 0 ? (
          <p className="text-muted small" data-testid="no-payments">No payments yet.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle" data-testid="all-payments">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Method</th>
                  <th scope="col">Code</th>
                  <th scope="col">Package</th>
                  <th scope="col">Covers</th>
                  <th scope="col">How</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>{paidOn(p.createdAt)}</td>
                    <td>{amountText(p.amountKes)}</td>
                    <td>{methodLabel(p.method)}</td>
                    <td className="font-monospace small">{p.code ?? '—'}</td>
                    <td>{tierLabel(p.tier)}{p.kind === 'trial_payment' ? ' (trial)' : ''}</td>
                    <td>{periodText(p.periodFrom, p.periodTo)}</td>
                    <td>{SOURCE_LABELS[p.source] ?? p.source ?? '—'}{p.backfilled ? ' (filled in)' : ''}</td>
                    <td className="small text-muted">{p.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {loading && <span className="spinner-border spinner-border-sm text-muted" role="status" aria-label="Loading" />}
        {!loading && cursor && (
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => load(cursor)}>Show more</button>
        )}

        <hr />
        <h3 className="h6">Older in-app payments</h3>
        <p className="small text-muted mb-2">
          Payments made in the app before this list existed can be filled in from Paystack. Check first: it only counts.
        </p>
        {check && (
          <p className="small mb-2" data-testid="backfill-check">
            {check.applied
              ? `Filled in ${check.written}. ${check.missing > 0 ? `${check.missing} still to fill in — run it again.` : 'All done.'}`
              : `${check.charges} in-app payment${check.charges === 1 ? '' : 's'} found; ${check.missing} not in the list yet.`}
          </p>
        )}
        <div className="d-flex gap-2">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={runCheck} disabled={filling}>Check</button>
          {check && check.missing > 0 && (
            <button type="button" className="btn btn-sm btn-primary" onClick={fillIn} disabled={filling}>
              {filling ? 'Filling in…' : `Fill in ${check.missing}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
