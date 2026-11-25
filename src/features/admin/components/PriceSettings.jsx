import { useCallback, useEffect, useState } from 'react';
import Modal from '@shared/components/ui/Modal';
import { getPrices, refreshPrices, changePrice } from '@services/api/adminPrices';

/**
 * Prices — 013Fixes / 26 (owner: "a form for changing prices for each package
 * that will change everywhere even in Paystack and update immediately").
 *
 * The price of each package is its Paystack plan, SHARED by every school, so
 * the confirmation says so in plain words; the new price applies from each
 * school's next payment. In live mode the plan's name is typed back. "Refresh
 * prices now" shows a change made in another deployment at once.
 */

const PLANS = [
  { id: 'bronze', name: 'Bronze' },
  { id: 'silver', name: 'Silver' },
  { id: 'gold', name: 'Gold' },
];
const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;
const SOURCE_NOTE = {
  stored: "Paystack couldn't be reached just now: these are the last prices it gave.",
  code: "Paystack couldn't be reached and none are saved yet: these are the built-in prices.",
};

/** "Silver would cost more than Gold." — only a warning. */
export function orderWarning(prices) {
  for (const [lower, higher] of [['bronze', 'silver'], ['silver', 'gold']]) {
    if (prices[lower] >= prices[higher]) {
      const a = PLANS.find((p) => p.id === lower).name;
      const b = PLANS.find((p) => p.id === higher).name;
      return `${a} would cost ${prices[lower] === prices[higher] ? 'the same as' : 'more than'} ${b}.`;
    }
  }
  return null;
}

export default function PriceSettings() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async (fn = getPrices) => {
    setError('');
    try { setData(await fn()); } catch (err) { setError(err?.message || 'Could not load the prices.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const live = data?.mode === 'live';
  const plan = PLANS.find((p) => p.id === editing);
  const n = Number(amount);
  const amountOk = /^\d+$/.test(amount.trim()) && n >= 1 && n <= 1_000_000;
  const next = data && editing ? { ...data.prices, [editing]: n } : null;
  const warning = next && amountOk ? orderWarning(next) : null;
  const nameOk = !live || typed.trim().toLowerCase() === plan?.name.toLowerCase();

  const startEdit = (id) => { setEditing(id); setAmount(String(data.prices[id])); setNote(''); setError(''); };
  const cancel = () => { if (!busy) { setEditing(null); setConfirming(false); setTyped(''); } };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await changePrice({ tier: editing, amountKes: n, ...(live ? { confirmName: typed.trim() } : {}) });
      setData(res);
      setNote(`${plan.name} is now ${kes(n)} a month for every school, from each school's next payment.${res.warning ? ` Note: ${res.warning}` : ''}`);
      setEditing(null);
      setConfirming(false);
      setTyped('');
    } catch (err) {
      setError(err?.message || 'Could not change the price.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mb-4" data-testid="price-settings">
      <div className="card-header d-flex align-items-center justify-content-between gap-2 flex-wrap">
        <h2 className="h5 mb-0">
          <i className="bi bi-tag me-2" aria-hidden="true" />Prices{' '}
          {data && (
            <span className={`badge ${live ? 'text-bg-danger' : 'text-bg-warning'} ms-1`} data-testid="price-mode">
              {live ? 'Live' : 'Test mode'}
            </span>
          )}
        </h2>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => load(refreshPrices)} disabled={busy}>
          Refresh prices now
        </button>
      </div>
      <div className="card-body">
        <p className="small text-muted">
          Each package's price is its Paystack plan, shared by every school. A change applies from each school's next payment.
        </p>
        {error && !confirming && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
        {note && <div className="alert alert-success small py-2" role="status">{note}</div>}
        {data && SOURCE_NOTE[data.source] && <div className="alert alert-warning small py-2">{SOURCE_NOTE[data.source]}</div>}
        {!data && !error && <span className="spinner-border spinner-border-sm text-muted" role="status" aria-label="Loading" />}
        {data && (
          <ul className="list-group">
            {PLANS.map((p) => (
              <li className="list-group-item d-flex align-items-center gap-2 flex-wrap" key={p.id} data-testid={`price-${p.id}`}>
                <strong className="me-auto">{p.name}</strong>
                {editing === p.id ? (
                  <>
                    <label className="visually-hidden" htmlFor={`price-input-${p.id}`}>{p.name} price (KES a month)</label>
                    <input id={`price-input-${p.id}`} type="text" inputMode="numeric" className="form-control form-control-sm w-auto"
                      value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <button type="button" className="btn btn-sm btn-primary" disabled={!amountOk || n === data.prices[p.id]} onClick={() => setConfirming(true)}>Continue</button>
                    <button type="button" className="btn btn-sm btn-link" onClick={cancel}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span>{kes(data.prices[p.id])} a month</span>
                    <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => startEdit(p.id)} disabled={busy || Boolean(editing)}>Edit</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirming && plan && (
        <Modal
          title="Change the price"
          onClose={cancel}
          footer={(
            <>
              <button type="button" className="btn btn-outline-secondary" onClick={() => setConfirming(false)} disabled={busy}>Back</button>
              <button type="button" className={`btn ${live ? 'btn-danger' : 'btn-primary'}`} onClick={save} disabled={busy || !nameOk}>
                {busy ? 'Changing…' : 'Change the price'}
              </button>
            </>
          )}
        >
          {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
          <div data-testid="price-confirm">
            <p className="mb-2">
              Change {plan.name} from {kes(data.prices[editing])} to {kes(n)} a month?
            </p>
            <p className="small mb-2">
              This changes the price for <strong>every school</strong> (the Paystack plans are shared). Each school pays it from its next payment.
            </p>
            {warning && <div className="alert alert-warning small py-2 mb-2" data-testid="price-order-warning">{warning}</div>}
            {live && (
              <>
                <label className="form-label small fw-semibold" htmlFor="price-confirm-name">Type {plan.name} to confirm (live payments)</label>
                <input id="price-confirm-name" type="text" className="form-control" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
