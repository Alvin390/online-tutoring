import { useEffect, useState } from 'react';
import { getAccountNotes, saveAccountNotes } from '@services/api/adminBilling';
import { paidOn } from '@/features/billing/payments/paymentFormat';

/**
 * Private notes on the school — 013Fixes / 22b (owner suggestion 4): the
 * contact person, the agreed price and any promises. Superadmin only; never
 * sent to a teacher. Each save keeps what changed in the history below.
 */

const FIELDS = [
  { id: 'contact', label: 'Contact person' },
  { id: 'agreedPrice', label: 'Agreed price' },
  { id: 'promises', label: 'Promises' },
];
const EMPTY = { contact: '', agreedPrice: '', promises: '' };

export default function AccountNotes() {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(EMPTY);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const apply = (res) => {
    const n = { ...EMPTY, ...(res.notes ?? {}) };
    setSaved(n);
    setDraft({ contact: n.contact, agreedPrice: n.agreedPrice, promises: n.promises });
    setHistory(res.history ?? []);
  };

  useEffect(() => {
    let live = true;
    getAccountNotes()
      .then((res) => { if (live) apply(res); })
      .catch((err) => { if (live) setMessage(err?.message || 'Could not load the notes.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const dirty = saved && FIELDS.some((f) => draft[f.id] !== saved[f.id]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await saveAccountNotes(draft);
      apply(await getAccountNotes());
      setMessage('Notes saved.');
    } catch (err) {
      setMessage(err?.message || 'Could not save the notes.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="mt-3"><span className="spinner-border spinner-border-sm text-muted" role="status" aria-label="Loading" /></div>;

  return (
    <form className="mt-3 border-top pt-3" onSubmit={save} data-testid="account-notes" aria-label="Notes on the school">
      <p className="small text-muted mb-2">Only you see these. Never shown to the school.</p>
      {FIELDS.map((f) => (
        <div className="mb-2" key={f.id}>
          <label className="form-label small fw-semibold mb-0" htmlFor={`note-${f.id}`}>{f.label}</label>
          <textarea id={`note-${f.id}`} className="form-control form-control-sm" rows={2} maxLength={2000}
            value={draft[f.id]} onChange={(e) => setDraft({ ...draft, [f.id]: e.target.value })} />
        </div>
      ))}
      <div className="d-flex align-items-center gap-2">
        <button type="submit" className="btn btn-sm btn-primary" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save notes'}</button>
        {message && <span className="small" role="status">{message}</span>}
      </div>
      {history.length > 0 && (
        <details className="mt-2">
          <summary className="small">Changes ({history.length})</summary>
          <ul className="small mb-0 mt-1" data-testid="notes-history">
            {history.map((h) => (
              <li key={`${h.at}-${Object.keys(h.after).join()}`}>
                {paidOn(h.at)}: {Object.keys(h.after).map((k) => FIELDS.find((f) => f.id === k)?.label ?? k).join(', ')} changed
              </li>
            ))}
          </ul>
        </details>
      )}
    </form>
  );
}
