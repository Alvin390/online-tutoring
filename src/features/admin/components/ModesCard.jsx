import { useCallback, useEffect, useState } from 'react';
import { getModes, setPaymentsMode, setSmsMode, setMaintenance } from '@services/api/adminModes';
import { modesStore } from '@shared/config/modesStore';

/**
 * Superadmin → Settings → Modes — 013Fixes / 33 (owner answer 4).
 *
 * Payments: Paystack live or test. The M-Pesa STK has its own Off / Demo /
 * Live setting (the card below). With nothing chosen here, the server's
 * PAYSTACK_MODE decides. To live: only with live keys. To test while the
 * school is in a paid period: type TEST first.
 *
 * SMS (33b): real or fake. Fake sends nothing and uses no SMS units; check-in
 * codes are then read out by the teacher, and the teacher's test SMS waits.
 *
 * Maintenance (34): students and teachers see "Under maintenance" (with the
 * message and expected end); this page, webhooks and crons keep working.
 */

/** What the rest of this page (the red banner) should show, at once. */
function publish(res) {
  if (!res) return;
  const m = res.maintenance;
  modesStore.setFromRemote({
    ...modesStore.get(),
    paymentsTest: res.payments?.mode !== 'live',
    smsFake: res.sms?.mode === 'fake',
    maintenance: m?.on ? { message: m.message ?? null, until: m.until ?? null } : null,
  });
}

const SOURCE = { setting: 'chosen here', env: 'from the server settings' };

export default function ModesCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [mMessage, setMMessage] = useState('');
  const [mUntil, setMUntil] = useState('');

  const run = useCallback(async (fn, okNote = '') => {
    setBusy(true);
    setError('');
    try {
      const res = await fn();
      setData(res);
      setNote(okNote);
      publish(res);
      return res;
    } catch (err) {
      if (err?.code === 'confirm_required') setConfirming(true);
      setError(err?.message || 'That did not work.');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { run(getModes); }, [run]);

  if (!data) {
    return (
      <div className="card mt-4" data-testid="modes-card">
        <div className="card-body">{error ? <div className="alert alert-danger small" role="alert">{error}</div> : <span className="spinner-border spinner-border-sm text-muted" role="status" aria-label="Loading" />}</div>
      </div>
    );
  }

  const p = data.payments;
  const applied = 'Takes effect within a minute or two everywhere.';
  const choose = async (mode) => {
    if (mode === p.mode) return;
    const res = await run(() => setPaymentsMode(mode), `Payments are now ${mode}. ${applied}`);
    if (res) { setConfirming(false); setTyped(''); }
  };
  const s = data.sms;
  const mt = data.maintenance ?? { on: false };
  const startMaintenance = async () => {
    const until = mUntil ? new Date(mUntil).getTime() : null;
    const res = await run(() => setMaintenance({ on: true, message: mMessage.trim(), until }), `Maintenance is on. ${applied}`);
    if (res) { setMMessage(''); setMUntil(''); }
  };
  const chooseSms = (mode) => mode !== s.mode && run(() => setSmsMode(mode), `SMS are now ${mode}. ${applied}`);
  const confirmTest = async () => {
    const res = await run(() => setPaymentsMode('test', typed.trim()), `Payments are now test. ${applied}`);
    if (res) { setConfirming(false); setTyped(''); }
  };

  return (
    <div className="card mt-4" data-testid="modes-card">
      <div className="card-header">
        <h2 className="h5 mb-0"><i className="bi bi-toggles me-2" aria-hidden="true" />Modes</h2>
      </div>
      <div className="card-body">
        {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
        {note && <div className="alert alert-success small py-2" role="status">{note}</div>}

        <h3 className="h6">Payments (Paystack){' '}
          <span className={`badge text-bg-${p.mode === 'live' ? 'success' : 'warning'}`} data-testid="payments-badge">{p.mode === 'live' ? 'Live' : 'Test'}</span>
        </h3>
        <div className="btn-group mb-2" role="radiogroup" aria-label="Payments mode">
          {['live', 'test'].map((m) => (
            <button key={m} type="button" role="radio" aria-checked={p.mode === m} disabled={busy || (m === 'live' && !p.liveKeys)}
              className={`btn btn-sm ${p.mode === m ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => choose(m)}>
              {m === 'live' ? 'Live' : 'Test'}
            </button>
          ))}
        </div>
        <p className="small text-muted mb-1" data-testid="payments-help">
          {p.mode === 'live' ? 'Real card and M-Pesa plan payments.' : 'Test payments: no real money. Teachers see a banner saying so.'}
          {' '}Currently {SOURCE[p.source] ?? p.source}.
          {!p.liveKeys && ' No live Paystack keys in the server settings yet.'}
        </p>
        <p className="small text-muted mb-0">M-Pesa &ldquo;Pay now&rdquo; for students has its own setting (M-Pesa payments, below).</p>

        <h3 className="h6 mt-4">SMS{' '}
          <span className={`badge text-bg-${s.mode === 'real' ? 'success' : 'warning'}`} data-testid="sms-badge">{s.mode === 'real' ? 'Real' : 'Fake'}</span>
        </h3>
        <div className="btn-group mb-2" role="radiogroup" aria-label="SMS mode">
          {['real', 'fake'].map((m) => (
            <button key={m} type="button" role="radio" aria-checked={s.mode === m} disabled={busy}
              className={`btn btn-sm ${s.mode === m ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => chooseSms(m)}>
              {m === 'real' ? 'Real' : 'Fake'}
            </button>
          ))}
        </div>
        <p className="small text-muted mb-0" data-testid="sms-help">
          {s.mode === 'real'
            ? 'Messages go out through HashBack and use SMS units.'
            : 'Nothing is sent and no SMS units are used; messages are recorded as fake. Check-in codes are read out by the teacher. Teachers see a banner saying so.'}
          {' '}Currently {SOURCE[s.source] ?? s.source}.
        </p>

        <h3 className="h6 mt-4">Maintenance{' '}
          <span className={`badge text-bg-${mt.on ? 'danger' : 'secondary'}`} data-testid="maintenance-badge">{mt.on ? 'On' : 'Off'}</span>
        </h3>
        {mt.on ? (
          <div className="alert alert-danger small py-2" data-testid="maintenance-on">
            Students and teachers see &ldquo;Under maintenance&rdquo;{mt.message ? `: ${mt.message}` : '.'}
            {' '}This page, payments callbacks and scheduled jobs keep working.
            <div className="mt-2">
              <button type="button" className="btn btn-sm btn-outline-danger" disabled={busy}
                onClick={() => run(() => setMaintenance({ on: false }), `Maintenance is off. ${applied}`)}>Switch off</button>
            </div>
          </div>
        ) : (
          <div className="row g-2 align-items-end" data-testid="maintenance-form">
            <div className="col-md-6">
              <label className="form-label small fw-semibold mb-0" htmlFor="maintenance-message">Message (optional)</label>
              <input id="maintenance-message" className="form-control form-control-sm" maxLength={200} value={mMessage} onChange={(e) => setMMessage(e.target.value)} />
            </div>
            <div className="col-md-4">
              <label className="form-label small fw-semibold mb-0" htmlFor="maintenance-until">Expected back (optional)</label>
              <input id="maintenance-until" className="form-control form-control-sm" type="datetime-local" value={mUntil} onChange={(e) => setMUntil(e.target.value)} />
            </div>
            <div className="col-md-2">
              <button type="button" className="btn btn-sm btn-danger w-100" disabled={busy} onClick={startMaintenance}>Switch on</button>
            </div>
          </div>
        )}

        {confirming && (
          <div className="border rounded p-3 mt-3 bg-light" data-testid="payments-confirm">
            <p className="small mb-2">The school is in a paid period. Payments made on test are not real. Type <strong>TEST</strong> to switch.</p>
            <div className="d-flex gap-2">
              <label className="visually-hidden" htmlFor="payments-confirm-input">Type TEST</label>
              <input id="payments-confirm-input" className="form-control form-control-sm w-auto" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              <button type="button" className="btn btn-sm btn-warning" disabled={busy || typed.trim() !== 'TEST'} onClick={confirmTest}>Switch to test</button>
              <button type="button" className="btn btn-sm btn-link" onClick={() => { setConfirming(false); setTyped(''); setError(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
