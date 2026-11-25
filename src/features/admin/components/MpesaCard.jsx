import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getMpesaSetup, saveMpesaKeys, clearMpesaKeys, setMpesaMode, sendMpesaTest, checkMpesaTest,
} from '@services/api/adminDaraja';

/**
 * Superadmin → M-Pesa payments (STK) — 013Fixes / 29-30b (owner answer 5;
 * owner, 2026-11-25). One setting, three positions:
 *
 *   Off   Pay now hidden everywhere.
 *   Demo  Pay now for every blocked student, through Safaricom's sandbox. A
 *         demo payment runs the whole flow but never pays fees or unblocks.
 *   Live  the school's live keys (write-only: only the last 4 characters come
 *         back). Untested → hidden; once the KES 1 test is confirmed →
 *         tested and shown. Changing the keys makes it untested again.
 * Gold only.
 */

const MODES = [
  { id: 'off', label: 'Off' },
  { id: 'demo', label: 'Demo' },
  { id: 'live', label: 'Live' },
];
const FIELDS = [
  { id: 'consumerKey', label: 'Consumer key', secret: true },
  { id: 'consumerSecret', label: 'Consumer secret', secret: true },
  { id: 'passkey', label: 'Passkey', secret: true },
  { id: 'shortCode', label: 'Till or paybill number', secret: false },
];
const EMPTY = { consumerKey: '', consumerSecret: '', passkey: '', shortCode: '', shortCodeType: 'till' };
const POLL_MS = 10_000;
const when = (ms) => new Date(ms).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' });

function badge(m) {
  if (m.mode === 'off') return { text: 'Off', tone: 'secondary' };
  if (m.mode === 'demo') return { text: 'Demo', tone: 'info' };
  if (m.testPending) return { text: 'Live — testing…', tone: 'info' };
  if (m.liveTested) return { text: 'Live — tested', tone: 'success' };
  return { text: 'Live — untested', tone: 'warning' };
}

export default function MpesaCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [phone, setPhone] = useState('');
  const timer = useRef(null);

  const run = useCallback(async (fn, okNote = '') => {
    setBusy(true);
    setError('');
    try {
      const res = await fn();
      setData(res);
      setNote(okNote);
      return res;
    } catch (err) {
      setError(err?.message || 'That did not work.');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { run(getMpesaSetup); }, [run]);

  // While a test is in flight, ask for its result now and then.
  const pending = data?.mpesa?.testPending === true;
  useEffect(() => {
    if (!pending) return undefined;
    timer.current = setTimeout(async () => {
      try { setData(await checkMpesaTest()); } catch { /* the next tick asks again */ }
    }, POLL_MS);
    return () => clearTimeout(timer.current);
  }, [pending, data]);

  if (!data) {
    return (
      <div className="card mt-4" data-testid="mpesa-card">
        <div className="card-body">{error ? <div className="alert alert-danger small" role="alert">{error}</div> : <span className="spinner-border spinner-border-sm text-muted" role="status" aria-label="Loading" />}</div>
      </div>
    );
  }

  const m = data.mpesa;
  const b = badge(m);
  const live = m.mode === 'live';
  const liveKeysMissing = !data.sources?.live;
  const formOpen = showForm || (live && liveKeysMissing);
  const formOk = FIELDS.every((f) => form[f.id].trim()) && /^\d{5,8}$/.test(form.shortCode.trim());

  const MODE_NOTES = {
    off: 'Switched off. Pay now is hidden everywhere.',
    demo: 'Demo on. Every blocked student sees Pay now, through the sandbox; it doesn’t pay fees.',
    live: 'Live on. Pay now appears once the live keys are tested.',
  };

  const save = async (e) => {
    e.preventDefault();
    const res = await run(() => saveMpesaKeys({ ...form, shortCode: form.shortCode.trim() }), 'Keys saved. Live is untested until the KES 1 test passes.');
    if (res) { setForm(EMPTY); setShowForm(false); }
  };

  return (
    <div className="card mt-4" data-testid="mpesa-card">
      <div className="card-header d-flex align-items-center justify-content-between gap-2 flex-wrap">
        <h2 className="h5 mb-0">
          <i className="bi bi-phone me-2" aria-hidden="true" />M-Pesa payments (STK){' '}
          <span className={`badge text-bg-${b.tone} ms-1`} data-testid="mpesa-badge">{b.text}</span>
        </h2>
      </div>
      <div className="card-body">
        {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
        {note && <div className="alert alert-success small py-2" role="status">{note}</div>}

        <div className="btn-group mb-2" role="radiogroup" aria-label="M-Pesa mode">
          {MODES.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={m.mode === x.id} disabled={busy}
              className={`btn btn-sm ${m.mode === x.id ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => m.mode !== x.id && run(() => setMpesaMode(x.id), MODE_NOTES[x.id])}>
              {x.label}
            </button>
          ))}
        </div>
        <p className="small text-muted mb-2" data-testid="mpesa-mode-help">
          {m.mode === 'off' && 'Students only see the receipt route.'}
          {m.mode === 'demo' && 'Every blocked student sees Pay now, through Safaricom’s sandbox (test M-Pesa). A demo payment shows success but doesn’t pay fees or unblock anyone. For showing how it works.'}
          {live && 'The school’s own till or paybill. Students see Pay now once the live keys pass the KES 1 test.'}
        </p>
        <ul className="small text-muted mb-3" data-testid="mpesa-ready">
          {!data.ready.gold && <li className="text-danger">Gold only: this school&apos;s plan doesn&apos;t include it.</li>}
          {!data.ready.flag && <li className="text-danger">The payments.daraja feature flag is off.</li>}
          {m.mode === 'demo' && !data.sources?.sandbox && <li className="text-danger">No sandbox keys in the server settings.</li>}
          {live && m.liveTested && m.testedAt && <li>Tested: confirmed by M-Pesa on {when(m.testedAt)}{m.testPhoneMasked ? ` (${m.testPhoneMasked})` : ''}.</li>}
          {live && !m.liveTested && m.lastError && <li className="text-danger" data-testid="mpesa-last-error">Last test: {m.lastError}</li>}
        </ul>

        <h3 className="h6">Live keys</h3>
        {data.keys.saved ? (
          <p className="small mb-2" data-testid="mpesa-keys">
            Saved {when(data.keys.savedAt)}: {data.keys.shortCodeType === 'paybill' ? 'Paybill' : 'Till'} ••••{data.keys.last4.shortCode},
            consumer key ••••{data.keys.last4.consumerKey}, secret ••••{data.keys.last4.consumerSecret}, passkey ••••{data.keys.last4.passkey}.
          </p>
        ) : (
          <p className="small text-muted mb-2" data-testid="mpesa-keys">
            {data.sources?.live === 'env' ? 'Using the live keys from the server settings.' : 'No live keys yet: enter the school’s M-Pesa keys (after Safaricom Go-Live).'}
          </p>
        )}
        {!formOpen && (
          <div className="d-flex gap-2 mb-3">
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setShowForm(true)} disabled={busy}>{data.keys.saved ? 'Replace keys' : 'Enter keys'}</button>
            {data.keys.saved && <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => run(clearMpesaKeys, 'Keys removed. Live is untested.')} disabled={busy}>Remove keys</button>}
          </div>
        )}
        {formOpen && (
          <form className="border rounded p-3 mb-3 bg-light" onSubmit={save} aria-label="M-Pesa keys" data-testid="mpesa-form">
            <p className="small text-muted">Never shown again after saving (only the last 4 characters). New keys make Live untested until the KES 1 test passes.</p>
            <div className="row g-2">
              {FIELDS.map((f) => (
                <div className="col-md-6" key={f.id}>
                  <label className="form-label small fw-semibold mb-0" htmlFor={`mpesa-${f.id}`}>{f.label}</label>
                  <input id={`mpesa-${f.id}`} className="form-control form-control-sm" type={f.secret ? 'password' : 'text'} autoComplete="off"
                    inputMode={f.secret ? undefined : 'numeric'} value={form[f.id]} onChange={(e) => setForm({ ...form, [f.id]: e.target.value })} />
                </div>
              ))}
              <div className="col-md-6">
                <label className="form-label small fw-semibold mb-0" htmlFor="mpesa-type">Type</label>
                <select id="mpesa-type" className="form-select form-select-sm" value={form.shortCodeType} onChange={(e) => setForm({ ...form, shortCodeType: e.target.value })}>
                  <option value="till">Till (Buy Goods)</option>
                  <option value="paybill">Paybill</option>
                </select>
              </div>
            </div>
            <div className="d-flex gap-2 mt-3">
              <button type="submit" className="btn btn-sm btn-primary" disabled={!formOk || busy}>Save keys</button>
              {(showForm || !(live && liveKeysMissing)) && <button type="button" className="btn btn-sm btn-link" onClick={() => { setShowForm(false); setForm(EMPTY); }}>Cancel</button>}
            </div>
          </form>
        )}

        {live && !liveKeysMissing && (
          <>
            <h3 className="h6">Test payment</h3>
            <p className="small text-muted mb-2">KES 1 from the phone you type, to the school&apos;s till or paybill. Tested once M-Pesa confirms it.</p>
            <div className="d-flex gap-2 flex-wrap align-items-center">
              <label className="visually-hidden" htmlFor="mpesa-test-phone">Phone for the test</label>
              <input id="mpesa-test-phone" className="form-control form-control-sm w-auto" type="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <button type="button" className="btn btn-sm btn-success" disabled={busy || !phone.trim() || pending}
                onClick={() => run(() => sendMpesaTest(phone.trim()), 'Check the phone for the M-Pesa prompt (KES 1).')}>
                Send test payment (KES 1)
              </button>
              {pending && (
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => run(checkMpesaTest)} disabled={busy}>Check result</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
