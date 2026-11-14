import { useState } from 'react';
import { setAdmissionNumber, allowCheckinAgain } from '@services/api/admission';
import { formatNumber } from '@utils/admissionNumber';
import { useOptionalToast } from '@/context/ToastContext';
import AdmissionNumberField from '@/features/registration/components/AdmissionNumberField';

/**
 * A student's admission (or staff) number, for the teacher — 008Fixes / 05.
 * Lazy (the drawer and the Staff tab load it on demand).
 *
 *   - the number, or "No number yet" (they choose one at their next check-in);
 *   - Change / Set number, with the same live check and easy-number rule the
 *     students get (owner answer 7). The old number is freed;
 *   - "Allow again" (answer 8): lets them check in on another device for this
 *     class. Shown for everyone: the lock lives off the record, so the
 *     dashboard can't tell who is locked without a read.
 */
export default function AdmissionActions({ session, phone, record }) {
  const toast = useOptionalToast();
  const kind = record?.staff === true ? 'staff' : 'student';
  const held = kind === 'staff' ? record?.staffNumber : record?.admissionNumber;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [status, setStatus] = useState('format');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmAllow, setConfirmAllow] = useState(false);
  const [saved, setSaved] = useState(null);
  const shown = saved ?? held ?? null;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await setAdmissionNumber(session, phone, value);
      setSaved(res.number);
      setEditing(false);
      toast?.showSuccess?.(`Number set to ${res.display}.`);
    } catch (err) {
      setError(err?.message || 'Could not save the number.');
    } finally {
      setBusy(false);
    }
  };

  const allow = async () => {
    setBusy(true);
    setError('');
    try {
      await allowCheckinAgain(session, phone);
      setConfirmAllow(false);
      toast?.showSuccess?.('Done. They can check in now.');
    } catch (err) {
      setError(err?.message || 'Could not allow it. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admission-actions" data-testid="admission-actions">
      <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
        <div>
          <div className="text-muted small">{kind === 'staff' ? 'Staff number' : 'Admission number'}</div>
          {shown
            ? <div className="fw-bold font-monospace fs-5" data-testid="admission-number">{formatNumber(kind, shown)}</div>
            : <div className="text-muted fst-italic" data-testid="admission-number">No number yet</div>}
        </div>
        {!editing && (
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => { setEditing(true); setValue(''); setError(''); }}>
            {shown ? 'Change' : 'Set number'}
          </button>
        )}
      </div>

      {editing && (
        <form onSubmit={save} className="mt-2" noValidate>
          <AdmissionNumberField
            session={session}
            kind={kind}
            value={value}
            onChange={(v) => { setValue(v); setError(''); }}
            onStatus={setStatus}
            label={kind === 'staff' ? 'New staff number' : 'New admission number'}
            autoFocus
          />
          <p className="small text-muted">The old number is freed; anyone can take it after this.</p>
          <div className="d-flex gap-2">
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !(status === 'free' || status === 'unknown')}>
              {busy ? 'Saving…' : 'Save number'}
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="mt-3">
        {!confirmAllow ? (
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setConfirmAllow(true)}>
            <i className="bi bi-phone me-1" aria-hidden="true" />
            Allow again
          </button>
        ) : (
          <div className="alert alert-light border small mb-0 py-2" role="group" aria-label="Allow again">
            <p className="mb-2">Let them check in on another device for this class?</p>
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-sm btn-primary" onClick={allow} disabled={busy}>
                {busy ? 'Allowing…' : 'Yes, allow'}
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setConfirmAllow(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="form-text">Use it if they changed phones, or their check-in says another device is in.</div>
      </div>

      {error && <div className="alert alert-danger small py-2 mt-2 mb-0" role="alert">{error}</div>}
    </div>
  );
}
