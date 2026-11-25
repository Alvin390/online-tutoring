import { useCallback, useEffect, useState } from 'react';
import { getSchoolPayments } from '@services/api/billing';
import { amountText, methodLabel, paidOn, periodText, tierLabel } from './paymentFormat';

/**
 * The school's payments on the billing page — 013Fixes / 21. Loaded when the
 * list is opened (one paged query), never on every visit. Date, amount,
 * method, package and the period each payment covered; no M-Pesa codes.
 */
export default function SchoolPayments() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (after) => {
    setLoading(true);
    setError('');
    try {
      const res = await getSchoolPayments(after);
      setItems((prev) => (after ? [...prev, ...res.items] : res.items));
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err?.message || 'Could not load your payments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(null); }, [load]);

  if (error) return <div className="alert alert-danger small" role="alert">{error}</div>;
  if (!loading && items.length === 0) return <p className="text-muted small mb-0" data-testid="no-payments">No payments yet.</p>;

  return (
    <div>
      <div className="table-responsive">
        <table className="table table-sm align-middle mb-2" data-testid="school-payments">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Amount</th>
              <th scope="col">Method</th>
              <th scope="col">Package</th>
              <th scope="col">Covers</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{paidOn(p.createdAt)}</td>
                <td>{amountText(p.amountKes)}</td>
                <td>{methodLabel(p.method)}</td>
                <td>{tierLabel(p.tier)}</td>
                <td>{periodText(p.periodFrom, p.periodTo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <span className="spinner-border spinner-border-sm text-muted" role="status" aria-label="Loading" />}
      {!loading && cursor && (
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => load(cursor)}>Show more</button>
      )}
    </div>
  );
}
