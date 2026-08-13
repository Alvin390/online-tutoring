import { useState, useEffect, useCallback } from 'react';
import { TIER_ORDER, TIERS } from '@shared/constants/tiers';
import { SkeletonList } from '@components/ui/Skeleton';
import { useToast } from '@/context/ToastContext';
import {
  listUsers, createTeacher, setUserTier, startTrial, setUserDisabled, deleteUser,
} from '@services/api/admin';
import logger from '@utils/logger';

/**
 * User administration for the superadmin console.
 *
 * Students are deliberately absent: they are created automatically on phone
 * verification, there can be hundreds, and they are managed from the teacher's
 * dashboard. This screen is about staff accounts and the subscription.
 */

function relative(iso) {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (Number.isNaN(days)) return '—';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function UserManager() {
  const [users, setUsers] = useState([]);
  const [studentCount, setStudentCount] = useState(0);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', displayName: '', tier: 'bronze' });
  const [formError, setFormError] = useState('');

  const [deleting, setDeleting] = useState(null);
  const [confirmEmail, setConfirmEmail] = useState('');

  const { showSuccess, showError } = useToast();

  const load = useCallback(async () => {
    try {
      const result = await listUsers();
      setUsers(result.users ?? []);
      setStudentCount(result.studentCount ?? 0);
      setSubscription(result.subscription ?? null);
    } catch (error) {
      logger.error('User list failed', error);
      showError(error?.message ?? 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, successMessage) => {
    setBusy(true);
    try {
      await fn();
      if (successMessage) showSuccess(successMessage);
      await load();
      return true;
    } catch (error) {
      logger.error('Admin action failed', error);
      showError(error?.message ?? 'That did not work.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');

    if (form.password.length < 12) {
      setFormError('Password must be at least 12 characters.');
      return;
    }

    const ok = await run(
      () => createTeacher(form),
      `Teacher account created for ${form.email}.`
    );
    if (ok) {
      setForm({ email: '', password: '', displayName: '', tier: 'bronze' });
      setCreating(false);
    }
  };

  return (
    <div className="card mb-4">
      <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h2 className="h5 mb-0">
          <i className="bi bi-people-fill me-2" aria-hidden="true" />
          Accounts
          <span className="badge text-bg-light text-muted ms-2">{users.length} staff</span>
          {studentCount > 0 && (
            <span className="badge text-bg-light text-muted ms-1">{studentCount} students</span>
          )}
        </h2>
        <button className="btn btn-sm btn-primary" onClick={() => setCreating(!creating)} disabled={busy}>
          <i className="bi bi-person-plus me-1" aria-hidden="true" />
          Add teacher
        </button>
      </div>

      <div className="card-body">
        {/* Current subscription — the thing most admin actions affect. */}
        {subscription && (
          <div className="alert alert-light border d-flex flex-wrap gap-4 align-items-center">
            <div>
              <span className="text-muted small d-block">Subscription</span>
              <strong className="text-capitalize">
                {subscription.tier ?? 'none'} · {subscription.status ?? 'none'}
              </strong>
            </div>
            {subscription.grantedBySuperadmin && (
              <span className="badge text-bg-info">Comped — billing cron skips this</span>
            )}
            {subscription.trialEndsAt && (
              <div>
                <span className="text-muted small d-block">Trial ends</span>
                <strong>{new Date(subscription.trialEndsAt).toLocaleDateString('en-KE')}</strong>
              </div>
            )}
          </div>
        )}

        {creating && (
          <form onSubmit={handleCreate} className="border rounded p-3 mb-3 bg-light">
            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label small fw-semibold" htmlFor="new-email">Email</label>
                <input
                  id="new-email" type="email" className="form-control" required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className="col-md-6">
                <label className="form-label small fw-semibold" htmlFor="new-password">
                  Password <span className="text-muted fw-normal">(12+ characters)</span>
                </label>
                <input
                  id="new-password" type="text" className="form-control" required minLength={12}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="new-password"
                />
                <div className="form-text">
                  Shown in plain text so you can copy it — give it to the teacher and have
                  them change it.
                </div>
              </div>
              <div className="col-md-6">
                <label className="form-label small fw-semibold" htmlFor="new-name">Name</label>
                <input
                  id="new-name" className="form-control"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label small fw-semibold" htmlFor="new-tier">Starting tier</label>
                <select
                  id="new-tier" className="form-select"
                  value={form.tier}
                  onChange={(e) => setForm({ ...form, tier: e.target.value })}
                >
                  {TIER_ORDER.map((t) => (
                    <option key={t} value={t}>{TIERS[t].name}</option>
                  ))}
                </select>
              </div>
            </div>

            {formError && (
              <div className="alert alert-danger py-2 px-3 small mt-2 mb-0" role="alert">
                {formError}
              </div>
            )}

            <div className="d-flex gap-2 mt-3">
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                Create account
              </button>
              <button
                type="button" className="btn btn-outline-secondary btn-sm"
                onClick={() => setCreating(false)} disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {loading && <SkeletonList rows={3} />}

        {!loading && users.length === 0 && (
          <p className="text-muted text-center py-3 mb-0">
            No staff accounts yet. Run <code>npm run seed:superadmin</code>, then add a teacher.
          </p>
        )}

        {!loading && users.length > 0 && (
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Role</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.uid} className={u.disabled ? 'opacity-50' : ''}>
                    <td>
                      <div className="fw-semibold">{u.email}</div>
                      <div className="small text-muted">
                        {u.displayName ?? '—'}
                        {u.disabled && <span className="badge text-bg-secondary ms-2">Disabled</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${u.role === 'superadmin' ? 'text-bg-dark' : 'text-bg-primary'}`}>
                        {u.role ?? 'no role'}
                      </span>
                    </td>
                    <td>
                      {u.role === 'superadmin' ? (
                        <span className="text-muted small">—</span>
                      ) : (
                        <select
                          className="form-select form-select-sm"
                          style={{ minWidth: 110 }}
                          value={u.tier ?? ''}
                          disabled={busy}
                          onChange={(e) =>
                            run(
                              () => setUserTier({ uid: u.uid, tier: e.target.value || null }),
                              `Tier set to ${e.target.value || 'none'}.`
                            )
                          }
                          aria-label={`Tier for ${u.email}`}
                        >
                          <option value="">none</option>
                          {TIER_ORDER.map((t) => (
                            <option key={t} value={t}>{TIERS[t].name}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="small text-muted">{relative(u.lastSignInAt)}</td>
                    <td>
                      <div className="d-flex gap-1 flex-wrap justify-content-end">
                        {u.role !== 'superadmin' && (
                          <button
                            className="btn btn-outline-info btn-sm"
                            disabled={busy}
                            onClick={() =>
                              run(
                                () => startTrial({ uid: u.uid, tier: 'gold', trialDays: 14 }),
                                '14-day Gold trial started.'
                              )
                            }
                            title="Start a 14-day Gold trial"
                          >
                            Trial
                          </button>
                        )}
                        <button
                          className="btn btn-outline-secondary btn-sm"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () => setUserDisabled({ uid: u.uid, disabled: !u.disabled }),
                              u.disabled ? 'Account re-enabled.' : 'Account disabled.'
                            )
                          }
                        >
                          {u.disabled ? 'Enable' : 'Disable'}
                        </button>
                        <button
                          className="btn btn-outline-danger btn-sm"
                          disabled={busy}
                          onClick={() => { setDeleting(u); setConfirmEmail(''); }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Delete is irreversible and leaves student data behind, so it takes
            a typed confirmation — the same pattern as session deletion. */}
        {deleting && (
          <div className="alert alert-danger mt-3 mb-0">
            <h3 className="h6 fw-bold">Permanently delete {deleting.email}?</h3>
            <p className="small mb-2">
              This removes the sign-in account and cannot be undone. Their students and
              fee history are <strong>not</strong> deleted — those stay in Firestore.
              If you only want to stop them signing in, use <strong>Disable</strong>,
              which is reversible.
            </p>
            <label className="form-label small fw-semibold" htmlFor="confirm-del">
              Type <code>{deleting.email}</code> to confirm
            </label>
            <input
              id="confirm-del"
              className="form-control form-control-sm mb-2"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              autoComplete="off"
            />
            <div className="d-flex gap-2">
              <button
                className="btn btn-danger btn-sm"
                disabled={busy || confirmEmail.toLowerCase() !== (deleting.email ?? '').toLowerCase()}
                onClick={async () => {
                  const ok = await run(
                    () => deleteUser({ uid: deleting.uid, confirmEmail }),
                    'Account deleted.'
                  );
                  if (ok) { setDeleting(null); setConfirmEmail(''); }
                }}
              >
                Delete permanently
              </button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setDeleting(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
