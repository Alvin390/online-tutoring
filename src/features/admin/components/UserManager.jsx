import { useState, useEffect, useCallback } from 'react';
import { TIER_ORDER, TIERS } from '@shared/constants/tiers';
import { SkeletonList } from '@components/ui/Skeleton';
import { useToast } from '@/context/ToastContext';
import {
  listUsers, createTeacher, setUserTier, setUserDisabled, deleteUser,
  setOwner, setDevLogin, setExtraLogins, recountUsage,
} from '@services/api/admin';
import UsageBars from '@features/billing/usage/UsageBars';
import StartTrialModal from './StartTrialModal';
import RecordPaymentModal from './RecordPaymentModal';
import AccountCard from './AccountCard';
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
  // 013Fixes / 12: the school's usage (from the stored count) and "Recount now".
  const [usage, setUsage] = useState(null);
  // 013Fixes / 22b: every plan (the downgrade warning) and the SMS units, for the account card.
  const [plans, setPlans] = useState(null);
  const [sms, setSms] = useState(null);
  // 013Fixes / 27: each plan's price (the server's), for the card and Record payment.
  const [prices, setPrices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // 013Fixes / 19: the school's "Start trial" form.
  const [startingTrial, setStartingTrial] = useState(false);
  // 013Fixes / 20: "Record payment" (a school that paid the owner directly).
  const [recordingPayment, setRecordingPayment] = useState(false);

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
      setUsage(result.usage ?? null);
      setPlans(result.plans ?? null);
      setSms(result.sms ?? null);
      setPrices(result.prices ?? null);
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
        <div className="d-flex gap-2">
          {/* 013Fixes / 19: a trial is the school's (one plan per school), not a login's. */}
          <button className="btn btn-sm btn-outline-info" onClick={() => setStartingTrial(true)} disabled={busy}>
            <i className="bi bi-hourglass-split me-1" aria-hidden="true" />
            Start trial
          </button>
          <button className="btn btn-sm btn-outline-success" onClick={() => setRecordingPayment(true)} disabled={busy}>
            <i className="bi bi-cash-coin me-1" aria-hidden="true" />
            Record payment
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setCreating(!creating)} disabled={busy}>
            <i className="bi bi-person-plus me-1" aria-hidden="true" />
            Add teacher
          </button>
        </div>
      </div>
      {recordingPayment && (
        <RecordPaymentModal
          currentTier={subscription?.tier ?? 'gold'}
          prices={prices}
          onClose={() => setRecordingPayment(false)}
          onRecorded={(res) => {
            setRecordingPayment(false);
            showSuccess(res.window?.startsNow ? 'Payment recorded. The school is open again.' : 'Payment recorded. It starts when the current period ends.');
            load();
          }}
        />
      )}
      {startingTrial && (
        <StartTrialModal
          currentTier={subscription?.tier ?? 'gold'}
          onClose={() => setStartingTrial(false)}
          onStarted={(res) => {
            setStartingTrial(false);
            showSuccess(`${res.days}-day ${TIERS[res.tier]?.name ?? res.tier} trial started.`);
            load();
          }}
        />
      )}

      <div className="card-body">
        {/* 013Fixes / 22b: the school's account card — plan, dates, last payment,
            SMS units and the actions. It replaced the old summary and its two
            test buttons ("Expire into grace" made the grace state the owner
            ruled out; "End access now" is Lock now). */}
        <AccountCard
          subscription={subscription}
          plans={plans}
          sms={sms}
          prices={prices}
          onChanged={(message) => { if (message) showSuccess(message); load(); }}
        />

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

        {!loading && (
          <div className="mb-3" data-testid="superadmin-usage">
            {usage ? <UsageBars usage={usage} title="School usage" /> : <p className="small text-muted mb-2">No usage counted yet.</p>}
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy}
              onClick={() => run(async () => { const r = await recountUsage(); setUsage(r.usage); }, 'Usage recounted.')}>
              Recount now
            </button>
          </div>
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
