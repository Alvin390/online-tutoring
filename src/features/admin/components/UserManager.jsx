import { useState, useEffect, useCallback } from 'react';
import { TIER_ORDER, TIERS } from '@shared/constants/tiers';
import { SkeletonList } from '@components/ui/Skeleton';
import { useToast } from '@/context/ToastContext';
import {
  listUsers, createTeacher, setUserTier, startTrial, setUserDisabled, deleteUser,
  expireToGrace, expireNow, setOwner, setDevLogin, setExtraLogins,
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
  // 013Fixes / 01: the school owner and the developer login.
  const [ownerUid, setOwnerUid] = useState(null);
  const [devLoginEmail, setDevLoginEmail] = useState(null);
  const [devEmailDraft, setDevEmailDraft] = useState('');
  const [movingOwner, setMovingOwner] = useState(null);
  // 013Fixes / 09: the school's seats and the extra logins added by hand.
  const [seats, setSeats] = useState(null);
  const [extraDraft, setExtraDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
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
      setOwnerUid(result.ownerUid ?? null);
      setDevLoginEmail(result.devLoginEmail ?? null);
      setDevEmailDraft(result.devLoginEmail ?? '');
      setSeats(result.seats ?? null);
      setExtraDraft(String(result.seats?.extra ?? 0));
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
      setForm({ email: '', password: '', displayName: '' });
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

            {/* Force an expiry, so the lockout flow can be exercised without
                waiting for calendar time. Both clear the comped flag — it
                short-circuits the state machine, so without clearing it these
                would appear to work and change nothing. */}
            <div className="ms-auto d-flex gap-2">
              <button
                type="button"
                className="btn btn-outline-warning btn-sm"
                disabled={busy}
                onClick={() =>
                  run(expireToGrace, 'Grace period started — access continues until the clock runs out.')
                }
                title="Set status to grace with a 48-hour clock. Access continues."
              >
                <i className="bi bi-hourglass-split me-1" aria-hidden="true" />
                Expire into grace
              </button>
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={busy}
                onClick={() => run(expireNow, 'Subscription expired — access cut immediately.')}
                title="Set status to expired. Access is cut on the next check."
              >
                <i className="bi bi-slash-circle me-1" aria-hidden="true" />
                End access now
              </button>
            </div>
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
            </div>
            <div className="form-text">
              The login gets the school&apos;s plan, the same as every other login.
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

        {/* 013Fixes / 01: the platform owner's own login. It works like any
            teacher login but never counts against the school's plan. */}
        {!loading && (
          <form
            className="border rounded p-3 mb-3"
            data-testid="dev-login"
            onSubmit={(e) => {
              e.preventDefault();
              const next = devEmailDraft.trim().toLowerCase() || null;
              run(() => setDevLogin({ devLoginEmail: next }), next ? 'Developer login saved.' : 'Developer login cleared.');
            }}
          >
            <label className="form-label small fw-semibold" htmlFor="dev-login-email">
              Developer login <span className="text-muted fw-normal">(yours; never counted against the plan)</span>
            </label>
            <div className="d-flex gap-2 flex-wrap">
              <input
                id="dev-login-email" type="email" className="form-control form-control-sm" style={{ maxWidth: 320 }}
                value={devEmailDraft}
                onChange={(e) => setDevEmailDraft(e.target.value)}
                placeholder="email of your dashboard login"
                autoComplete="off"
              />
              <button
                type="submit" className="btn btn-outline-primary btn-sm"
                disabled={busy || devEmailDraft.trim().toLowerCase() === (devLoginEmail ?? '')}
              >
                Save
              </button>
            </div>
          </form>
        )}

        {!loading && seats && (
          <form
            className="border rounded p-3 mb-3"
            data-testid="extra-logins"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(extraDraft);
              if (!/^\d+$/.test(extraDraft.trim()) || n > 1000) return;
              run(() => setExtraLogins({ extraLogins: n }), `Extra logins set to ${n}.`);
            }}
          >
            <div className="small mb-2" data-testid="seat-count">
              Logins: <strong>{seats.used} of {seats.limit}</strong> in use
              {' '}({seats.included} in the plan{seats.extra ? ` + ${seats.extra} extra` : ''}; the developer login isn&apos;t counted).
            </div>
            <label className="form-label small fw-semibold" htmlFor="extra-logins">
              Extra logins <span className="text-muted fw-normal">(added by hand after the school pays you)</span>
            </label>
            <div className="d-flex gap-2">
              <input id="extra-logins" className="form-control form-control-sm" style={{ maxWidth: 120 }} inputMode="numeric"
                value={extraDraft} onChange={(e) => setExtraDraft(e.target.value)} />
              <button type="submit" className="btn btn-outline-primary btn-sm"
                disabled={busy || extraDraft.trim() === String(seats.extra) || !/^\d+$/.test(extraDraft.trim())}>
                Save
              </button>
            </div>
          </form>
        )}

        {movingOwner && (
          <div className="alert alert-warning" role="alert" data-testid="owner-confirm">
            <p className="mb-2 small">
              Make <strong>{movingOwner.email}</strong> the school owner?
              {ownerUid && ` This replaces ${users.find((x) => x.uid === ownerUid)?.email ?? 'the current owner'}.`}
              {' '}The owner is the login that manages the school&apos;s other logins.
            </p>
            <div className="d-flex gap-2">
              <button
                type="button" className="btn btn-warning btn-sm" disabled={busy}
                onClick={async () => {
                  const ok = await run(() => setOwner({ uid: movingOwner.uid }), `${movingOwner.email} is now the school owner.`);
                  if (ok) setMovingOwner(null);
                }}
              >
                Make owner
              </button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setMovingOwner(null)}>
                Cancel
              </button>
            </div>
          </div>
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
                  <th scope="col" title="The school's plan. Changing it sets the school's plan (comp) for every login.">School plan</th>
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
                        {u.isOwner && <span className="badge text-bg-success ms-2">Owner</span>}
                        {u.isDeveloper && <span className="badge text-bg-info ms-2">Developer, not counted</span>}
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
                          value={subscription?.tier ?? ''}
                          disabled={busy}
                          onChange={(e) =>
                            run(
                              () => setUserTier({ uid: u.uid, tier: e.target.value || null }),
                              `School plan set to ${e.target.value || 'none'}.`
                            )
                          }
                          aria-label={`School plan (via ${u.email})`}
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
                                // The tier from THIS ROW, not a hardcoded gold.
                                // The dropdown to the left applies immediately,
                                // so "pick Silver, then click Trial" now starts
                                // a Silver trial rather than silently upgrading
                                // the account to Gold for fourteen days.
                                // 013Fixes / 01: the school's plan (one plan per school).
                                () => startTrial({
                                  uid: u.uid,
                                  tier: subscription?.tier ?? 'bronze',
                                  trialDays: 14,
                                }),
                                `14-day ${TIERS[subscription?.tier ?? 'bronze'].name} trial started.`
                              )
                            }
                            title={`Start a 14-day ${TIERS[subscription?.tier ?? 'bronze'].name} trial`}
                          >
                            Trial
                          </button>
                        )}
                        {u.role === 'teacher' && !u.isOwner && !u.disabled && (
                          <button
                            className="btn btn-outline-success btn-sm"
                            disabled={busy}
                            onClick={() => setMovingOwner(u)}
                            title="Make this login the school owner"
                          >
                            Make owner
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
