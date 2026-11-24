import { useCallback, useEffect, useState } from 'react';
import { getSmsCredits, addSmsUnits } from '@services/api/adminSms';

/**
 * Superadmin → SMS units — 013Fixes / 16 (owner answer 3: you add units by
 * hand after the school pays you; no checkout yet).
 *
 * The school's included units this window, how many are used, the extra
 * (top-up) units carried forward, the last 20 ledger entries, and
 * "Add SMS units" (units + a note such as the M-Pesa code). Units only.
 */

const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const TYPES = { grant: 'Included', upgrade_top: 'Upgrade', topup_added: 'Added by hand', reserve: 'Sent', refund: 'Given back', expire: 'Expired' };

export default function SmsUnitsCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [units, setUnits] = useState('');
  const [note, setNote] = useState('');
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(() => getSmsCredits().then(setData).catch((err) => setError(err?.message || 'Could not load the SMS units.')), []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setMessage('');
    const n = Number(units);
    if (!/^\d+$/.test(units.trim()) || n < 1) { setMessage('Enter a whole number of units, at least 1.'); return; }
    setBusy(true);
    try {
      const result = await addSmsUnits({ units: n, note: note.trim() || undefined, key });
      setData({ credits: result.credits, ledger: result.ledger });
      setMessage(result.already ? 'Already added.' : `${n.toLocaleString('en-KE')} units added.`);
      setUnits(''); setNote(''); setKey(newKey());
    } catch (err) {
      setMessage(err?.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="alert alert-danger small" role="alert">{error}</div>;
  if (!data) return null;
  const c = data.credits;

  return (
    <div className="card mt-4" data-testid="sms-units-card">
      <div className="card-header"><h2 className="h5 mb-0"><i className="bi bi-123 me-2" aria-hidden="true" />SMS units</h2></div>
      <div className="card-body">
        <div className="row g-3 mb-3 small">
          <div className="col-6 col-md-3"><div className="text-muted">Included this window</div><strong>{c.granted.toLocaleString('en-KE')}</strong></div>
          <div className="col-6 col-md-3"><div className="text-muted">Used</div><strong>{c.includedUsed.toLocaleString('en-KE')}</strong></div>
          <div className="col-6 col-md-3"><div className="text-muted">Extra (carried over)</div><strong>{c.topup.toLocaleString('en-KE')}</strong></div>
          <div className="col-6 col-md-3"><div className="text-muted">Left in all</div><strong data-testid="sms-units-available">{c.available.toLocaleString('en-KE')}</strong></div>
        </div>
        <form className="d-flex gap-2 flex-wrap align-items-end mb-3" onSubmit={add} aria-label="Add SMS units">
          <div>
            <label className="form-label small mb-0" htmlFor="add-units">Add units</label>
            <input id="add-units" className="form-control form-control-sm" style={{ maxWidth: 120 }} inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} />
          </div>
          <div>
            <label className="form-label small mb-0" htmlFor="add-units-note">Note (e.g. M-Pesa code)</label>
            <input id="add-units-note" className="form-control form-control-sm" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Add SMS units</button>
          {message && <span className="small" role="status">{message}</span>}
        </form>
        <div className="table-responsive">
          <table className="table table-sm small mb-0">
            <thead><tr><th>When</th><th>What</th><th className="text-end">Units</th><th>Note</th></tr></thead>
            <tbody>
              {data.ledger.map((e) => (
                <tr key={e.id}>
                  <td>{when(e.at)}</td>
                  <td>{TYPES[e.type] ?? e.type}</td>
                  <td className="text-end">{e.units > 0 ? `+${e.units}` : e.units}</td>
                  <td>{e.note ?? ''}</td>
                </tr>
              ))}
              {data.ledger.length === 0 && <tr><td colSpan={4} className="text-muted">Nothing yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
