import { useCallback, useEffect, useState } from 'react';
import { listWaitingCodes } from '@services/api/admission';

/**
 * Codes waiting — 008Fixes / 05 (owner answer 3). When a student's SMS
 * doesn't arrive, the teacher reads them their code from here. Loaded when
 * opened and on Refresh only; nothing listens. Lazy.
 */
const minutesLeft = (ms) => Math.max(0, Math.ceil(((ms ?? 0) - Date.now()) / 60_000));

export default function WaitingCodesPanel({ sessionNames = {} }) {
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = await listWaitingCodes();
      setCodes(res.codes ?? []);
    } catch (err) {
      setError(err?.message || 'Could not load the codes.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  return (
    <div className="card mb-3" data-testid="waiting-codes">
      <div className="card-body py-2 d-flex align-items-center justify-content-between gap-2 flex-wrap">
        <div>
          <strong><i className="bi bi-shield-lock me-2" aria-hidden="true" />Codes waiting{codes ? ` (${codes.length})` : ''}</strong>
          <div className="small text-muted">If a student&apos;s SMS doesn&apos;t arrive, read them their code.</div>
        </div>
        <div className="d-flex gap-2">
          {open && (
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={load} disabled={busy}>
              <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />
              Refresh
            </button>
          )}
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Hide' : 'Show codes'}
          </button>
        </div>
      </div>
      {open && (
        <div className="card-body pt-0">
          {busy && !codes && <div className="text-muted small">Loading…</div>}
          {error && <div className="alert alert-danger small py-2 mb-0" role="alert">{error}</div>}
          {codes && codes.length === 0 && <div className="text-muted small">No codes waiting.</div>}
          {codes && codes.length > 0 && (
            <ul className="list-group list-group-flush">
              {codes.map((c) => (
                <li key={`${c.session}/${c.phone}`} className="list-group-item px-0 d-flex justify-content-between align-items-center gap-2 flex-wrap">
                  <div>
                    <div className="fw-semibold">{c.name ?? 'Student'}</div>
                    <div className="small text-muted">
                      {sessionNames[c.session] ?? c.session} · phone ending {c.phoneEnding}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="font-monospace fw-bold fs-4" style={{ letterSpacing: '0.15em' }} data-testid="waiting-code">{c.code}</div>
                    <div className="small text-muted">expires in {minutesLeft(c.expiresAtMs)} min</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
