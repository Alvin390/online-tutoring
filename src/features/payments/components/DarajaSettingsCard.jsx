import { useCallback, useEffect, useState } from 'react';
import { getDarajaStatus, saveDarajaCredentials, testDarajaConnection } from '@services/api/payments';
import logger from '@utils/logger';

/**
 * M-Pesa (Daraja) settings — Phase 13 / 04 D4.
 *
 * The service calls for this existed since Phase 09 with no screen calling
 * them (validated: zero callers), so a teacher had no way to see whether M-Pesa
 * was configured, which till it pointed at, or the callback URL to register.
 *
 *  - STATUS always: configured or not, where the credentials come from, sandbox
 *    or live, last verified, and the callback URL with a copy button.
 *  - Credentials set by the server operator (source 'env') are READ-ONLY here;
 *    the API refuses a save in that case too.
 *  - Otherwise a form: short code, type, consumer key/secret, passkey. Secrets
 *    are write-only — never shown back, only a masked hint.
 *  - "Test connection" does an OAuth round trip only. It sends no STK push.
 */
export default function DarajaSettingsCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    shortCode: '', shortCodeType: 'paybill', environment: 'sandbox', consumerKey: '', consumerSecret: '', passkey: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getDarajaStatus());
    } catch (error) {
      logger.error('Daraja status failed', error);
      setResult({ ok: false, message: error?.message ?? 'Could not load M-Pesa settings.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await testDarajaConnection();
      setResult({ ok: r.verified, message: r.message });
      await load();
    } catch (error) {
      setResult({ ok: false, message: error?.message ?? 'The test could not run.' });
    } finally {
      setBusy(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await saveDarajaCredentials(form);
      setResult({ ok: true, message: r.note ?? 'Saved. Now run Test connection.' });
      setEditing(false);
      setForm((f) => ({ ...f, consumerKey: '', consumerSecret: '', passkey: '' }));
      await load();
    } catch (error) {
      setResult({ ok: false, message: error?.message ?? 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  const readOnly = status?.source === 'env';

  return (
    <div className="card mb-4" data-testid="daraja-settings">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h2 className="h6 mb-0">
          <i className="bi bi-phone me-2" aria-hidden="true" />
          Payments (M-Pesa)
        </h2>
        {status?.configured && (
          <span className={`badge ${status.environment === 'production' ? 'text-bg-success' : 'text-bg-warning'}`}>
            {status.environment === 'production' ? 'Live' : 'Sandbox'}
          </span>
        )}
      </div>

      <div className="card-body">
        {loading ? (
          <div className="text-center py-2"><span className="spinner-border spinner-border-sm text-muted" /></div>
        ) : (
          <>
            <dl className="row small mb-3">
              <dt className="col-5 text-muted fw-normal">Status</dt>
              <dd className="col-7">{status?.configured ? 'Configured' : 'Not set up'}</dd>

              {status?.configured && (
                <>
                  <dt className="col-5 text-muted fw-normal">Managed by</dt>
                  <dd className="col-7">{readOnly ? 'Server configuration' : 'You (saved here)'}</dd>
                  <dt className="col-5 text-muted fw-normal">Short code</dt>
                  <dd className="col-7">{status.shortCode} ({status.shortCodeType})</dd>
                  <dt className="col-5 text-muted fw-normal">Last verified</dt>
                  <dd className="col-7">
                    {status.verifiedAt ? new Date(status.verifiedAt).toLocaleString() : 'Not yet'}
                  </dd>
                </>
              )}
            </dl>

            {status?.callbackUrl && (
              <div className="mb-3">
                <label className="form-label small fw-semibold" htmlFor="daraja-callback-url">Callback URL</label>
                <div className="input-group input-group-sm">
                  <input id="daraja-callback-url" className="form-control font-monospace" value={status.callbackUrl} readOnly />
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => navigator.clipboard?.writeText(status.callbackUrl)}
                    aria-label="Copy callback URL"
                  >
                    <i className="bi bi-clipboard" aria-hidden="true" />
                  </button>
                </div>
                <div className="form-text">Sent with every payment request. Keep it private.</div>
              </div>
            )}

            {readOnly && (
              <p className="small text-muted mb-3">
                These credentials are set by the server configuration and cannot be changed here.
              </p>
            )}

            {result && (
              <div className={`alert py-2 small ${result.ok ? 'alert-success' : 'alert-danger'}`} role="status">
                {result.message}
              </div>
            )}

            <div className="d-flex gap-2 flex-wrap">
              {status?.configured && (
                <button type="button" className="btn btn-outline-primary btn-sm" onClick={test} disabled={busy}>
                  {busy ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-plug me-1" aria-hidden="true" />}
                  Test connection
                </button>
              )}
              {!readOnly && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing(!editing)} disabled={busy}>
                  {status?.configured ? 'Replace credentials' : 'Set up M-Pesa'}
                </button>
              )}
            </div>

            {editing && !readOnly && (
              <form className="border rounded p-3 mt-3 bg-light" onSubmit={save} autoComplete="off">
                <div className="row g-2">
                  <div className="col-6">
                    <label className="form-label small" htmlFor="dj-shortcode">Short code</label>
                    <input id="dj-shortcode" className="form-control form-control-sm" inputMode="numeric" value={form.shortCode}
                      onChange={(e) => setForm({ ...form, shortCode: e.target.value.replace(/\D/g, '') })} maxLength={7} required />
                  </div>
                  <div className="col-6">
                    <label className="form-label small" htmlFor="dj-type">Type</label>
                    <select id="dj-type" className="form-select form-select-sm" value={form.shortCodeType}
                      onChange={(e) => setForm({ ...form, shortCodeType: e.target.value })}>
                      <option value="paybill">Paybill</option>
                      <option value="till">Till (Buy Goods)</option>
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label small" htmlFor="dj-env">Environment</label>
                    <select id="dj-env" className="form-select form-select-sm" value={form.environment}
                      onChange={(e) => setForm({ ...form, environment: e.target.value })}>
                      <option value="sandbox">Sandbox (testing — no real money)</option>
                      <option value="production">Production (live)</option>
                    </select>
                  </div>
                  {[
                    ['consumerKey', 'Consumer key'],
                    ['consumerSecret', 'Consumer secret'],
                    ['passkey', 'Passkey'],
                  ].map(([field, label]) => (
                    <div className="col-12" key={field}>
                      <label className="form-label small" htmlFor={`dj-${field}`}>{label}</label>
                      <input id={`dj-${field}`} type="password" className="form-control form-control-sm" value={form[field]}
                        onChange={(e) => setForm({ ...form, [field]: e.target.value })} required minLength={10} autoComplete="new-password" />
                    </div>
                  ))}
                </div>
                <p className="small text-muted mt-2 mb-2">Stored encrypted. Never shown again after saving.</p>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Save</button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
