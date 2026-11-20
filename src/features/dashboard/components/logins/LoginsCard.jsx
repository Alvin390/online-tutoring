import { useCallback, useEffect, useState } from 'react';
import { listLogins, addLogin, disableLogin, enableLogin, removeLogin } from '@services/api/logins';
import { useOptionalToast } from '@/context/ToastContext';

/**
 * The school's dashboard logins — 013Fixes / 10 (owner, 2026-11-19).
 *
 * Shown to the school OWNER only (the server says who). The owner adds
 * logins and sets their passwords, up to what the plan includes; at the limit
 * the form is greyed out with "Contact us for more". Disabling or removing a
 * login frees its seat. The owner's own login and the platform's developer
 * login can't be changed here.
 */

const PLAIN = {
  email_taken: 'A login with that email already exists.',
  seat_limit: null, // the server's own words name the number
  confirmation_mismatch: 'Type the login\'s email exactly to remove it.',
};

function friendly(error) {
  if (error?.code && PLAIN[error.code]) return PLAIN[error.code];
  return error?.message || 'That did not work. Please try again.';
}

export default function LoginsCard() {
  const toast = useOptionalToast();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [removing, setRemoving] = useState(null);
  const [confirmEmail, setConfirmEmail] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await listLogins());
      setLoadError('');
    } catch (error) {
      setLoadError(friendly(error));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      toast?.showSuccess?.(success);
      await load();
      return true;
    } catch (error) {
      toast?.showError?.(friendly(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <div className="alert alert-danger small" role="alert">{loadError}</div>;
  if (!data) return null;

  const { logins, seats } = data;
  const full = seats.used >= seats.limit;

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (form.password.length < 12) { setFormError('Use a password of at least 12 characters.'); return; }
    setBusy(true);
    try {
      await addLogin(form);
      toast?.showSuccess?.(`Login added for ${form.email}. Give them the password and ask them to keep it private.`);
      setForm({ displayName: '', email: '', password: '' });
      await load();
    } catch (error) {
      setFormError(friendly(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mb-4" data-testid="logins-card">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
          <h2 className="h6 fw-bold mb-0"><i className="bi bi-person-lock me-2" aria-hidden="true" />Dashboard logins</h2>
          <span className={`badge ${full ? 'text-bg-warning' : 'text-bg-light text-muted'}`} data-testid="seat-count">
            Seats: {seats.used} of {seats.limit} used
          </span>
        </div>

        <ul className="list-group mb-3">
          {logins.map((l) => (
            <li key={l.uid} className={`list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2 ${l.disabled ? 'opacity-50' : ''}`}>
              <div className="small">
                <div className="fw-semibold">{l.displayName || l.email}</div>
                <div className="text-muted">
                  {l.email}
                  {l.isOwner && <span className="badge text-bg-success ms-2">Owner</span>}
                  {l.isDeveloper && <span className="badge text-bg-info ms-2">Support</span>}
                  {l.disabled && <span className="badge text-bg-secondary ms-2">Disabled</span>}
                </div>
              </div>
              {!l.isOwner && !l.isDeveloper && (
                <div className="d-flex gap-1">
                  <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy || (l.disabled && full)}
                    title={l.disabled && full ? 'Every seat is in use' : undefined}
                    onClick={() => run(() => (l.disabled ? enableLogin(l.uid) : disableLogin(l.uid)), l.disabled ? 'Login enabled.' : 'Login disabled. They are signed out.')}>
                    {l.disabled ? 'Enable' : 'Disable'}
                  </button>
                  <button type="button" className="btn btn-outline-danger btn-sm" disabled={busy}
                    onClick={() => { setRemoving(l); setConfirmEmail(''); }}>
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {removing && (
          <div className="alert alert-danger small" data-testid="remove-confirm">
            <p className="mb-2">Remove <strong>{removing.email}</strong>? They can no longer sign in. Students and fees are not touched.</p>
            <label className="form-label fw-semibold" htmlFor="remove-login-email">Type <code>{removing.email}</code> to confirm</label>
            <input id="remove-login-email" className="form-control form-control-sm mb-2" value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)} autoComplete="off" />
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-danger btn-sm"
                disabled={busy || confirmEmail.trim().toLowerCase() !== (removing.email ?? '').toLowerCase()}
                onClick={async () => { if (await run(() => removeLogin(removing.uid, confirmEmail.trim()), 'Login removed.')) setRemoving(null); }}>
                Remove login
              </button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setRemoving(null)}>Cancel</button>
            </div>
          </div>
        )}

        <form onSubmit={submit} aria-label="Add a login">
          <fieldset disabled={full || busy}>
            <legend className="small fw-semibold">Add a login</legend>
            {full && (
              <p className="small text-warning-emphasis mb-2" data-testid="seat-full">
                Your plan includes {seats.limit} logins. Contact us for more.
              </p>
            )}
            <div className="row g-2">
              <div className="col-md-4">
                <label className="form-label small mb-0" htmlFor="login-name">Name</label>
                <input id="login-name" className="form-control form-control-sm" value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </div>
              <div className="col-md-4">
                <label className="form-label small mb-0" htmlFor="login-email">Email</label>
                <input id="login-email" type="email" required className="form-control form-control-sm" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" />
              </div>
              <div className="col-md-4">
                <label className="form-label small mb-0" htmlFor="login-password">Password (12+ characters)</label>
                <div className="input-group input-group-sm">
                  <input id="login-password" type={showPassword ? 'text' : 'password'} required minLength={12}
                    className="form-control" value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    <i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
            {formError && <div className="text-danger small mt-2" role="alert">{formError}</div>}
            <button type="submit" className="btn btn-primary btn-sm mt-2">Add login</button>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
