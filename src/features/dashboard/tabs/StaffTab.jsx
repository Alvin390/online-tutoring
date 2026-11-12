import { useMemo, useState } from 'react';
import Modal from '@components/ui/Modal';
import SubjectPicker from '@features/registration/components/SubjectPicker';
import { subjectsForClass, parseSubjects, joinSubjects } from '@shared/constants/subjects';
import { buildWaLink } from '@utils/waLink';
import { useOptionalToast } from '@/context/ToastContext';
import { unmarkStaff } from '@services/api/students';

/**
 * Staff — 007Fixes / 10 (owner, 2026-11-11): "if they are teachers, there's
 * a place for the staff". Everyone marked as staff, across sessions, from the
 * staff side of the roster split (no new read). Name, phone, session,
 * subjects taught, since when; edit, back to student, delete, message one.
 * Its own lazy chunk.
 */

const dateOf = (value) => {
  const d = value?.toDate?.() ?? (value ? new Date(value) : null);
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' })
    : '';
};

function EditStaff({ person, sessionDoc, onSave, onClose }) {
  const [form, setForm] = useState({ studentName: person.studentName ?? '', phone: person.id, subjects: person.subjects ?? '' });
  const [saving, setSaving] = useState(false);
  // Subjects as at registration: the session's list for their class, if it has one.
  const options = subjectsForClass(sessionDoc, person.class);
  const save = async () => {
    setSaving(true);
    try {
      const result = await onSave(form);
      if (result?.success !== false) onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={`Edit ${person.studentName || 'staff member'}`} onClose={onClose} onConfirm={save} loading={saving} confirmLabel="Save">
      <div className="mb-3">
        <label className="form-label fw-bold" htmlFor="staff-edit-name">Name</label>
        <input id="staff-edit-name" className="form-control" value={form.studentName}
          onChange={(e) => setForm({ ...form, studentName: e.target.value })} />
      </div>
      <div className="mb-3">
        <label className="form-label fw-bold" htmlFor="staff-edit-phone">Phone</label>
        <input id="staff-edit-phone" type="tel" inputMode="tel" className="form-control" value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+254712345678" />
        <small className="text-muted">Changing it moves their notes and fee history to the new number.</small>
      </div>
      <div className="mb-1">
        <span className="form-label fw-bold d-block" id="staff-edit-subjects">Subjects taught</span>
        {options.length > 0 ? (
          <SubjectPicker
            options={options}
            value={parseSubjects(form.subjects)}
            onChange={(names) => setForm({ ...form, subjects: joinSubjects(names) })}
            lockCompulsory={false}
            describedBy="staff-edit-subjects"
            legend={`Subjects for ${person.class}`}
          />
        ) : (
          <input className="form-control" aria-labelledby="staff-edit-subjects" value={form.subjects}
            onChange={(e) => setForm({ ...form, subjects: e.target.value })} placeholder="English, Mathematics" />
        )}
      </div>
    </Modal>
  );
}

export default function StaffTab({ staffBySession = {}, sessions = [], onEdit, onDelete }) {
  const toast = useOptionalToast();
  const [query, setQuery] = useState('');
  const [session, setSession] = useState('');
  const [editing, setEditing] = useState(null);
  const [backing, setBacking] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const names = useMemo(() => Object.fromEntries(sessions.map((s) => [s.id, s.name ?? s.id])), [sessions]);
  const docs = useMemo(() => Object.fromEntries(sessions.map((s) => [s.id, s])), [sessions]);

  const everyone = useMemo(() => Object.entries(staffBySession)
    .flatMap(([id, list]) => (list ?? []).map((p) => ({ ...p, __session: id })))
    .sort((a, b) => String(a.studentName ?? '').localeCompare(String(b.studentName ?? ''))), [staffBySession]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return everyone.filter((p) => (!session || p.__session === session)
      && (!q || String(p.studentName ?? '').toLowerCase().includes(q) || (digits && p.id.replace(/\D/g, '').includes(digits))));
  }, [everyone, query, session]);

  const staffSessions = useMemo(() => [...new Set(everyone.map((p) => p.__session))], [everyone]);

  const confirmBack = async () => {
    setBusy(true);
    try {
      await unmarkStaff([{ session: backing.__session, phone: backing.id }]);
      toast?.showSuccess(`${backing.studentName || 'They'} ${backing.studentName ? 'is' : 'are'} a student again.`);
      setBacking(null);
    } catch (error) {
      toast?.showError(error?.message ?? 'Could not set them back to student. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const confirmDelete = async () => {
    setBusy(true);
    try {
      const result = await onDelete(deleting.__session, deleting.id, deleting.studentName);
      if (result?.success !== false) setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-header bg-white d-flex flex-wrap align-items-center justify-content-between gap-2">
        <h2 className="h5 mb-0"><i className="bi bi-person-badge me-2" aria-hidden="true" />Staff ({everyone.length})</h2>
        {everyone.length > 0 && (
          <div className="d-flex flex-wrap gap-2">
            <input
              type="search"
              className="form-control form-control-sm"
              style={{ minWidth: '12rem' }}
              placeholder="Search name or number"
              aria-label="Search staff"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {staffSessions.length > 1 && (
              <select className="form-select form-select-sm w-auto" aria-label="Session" value={session} onChange={(e) => setSession(e.target.value)}>
                <option value="">All sessions</option>
                {staffSessions.map((id) => <option key={id} value={id}>{names[id] ?? id}</option>)}
              </select>
            )}
          </div>
        )}
      </div>

      {everyone.length === 0 ? (
        <div className="card-body text-center text-muted py-5">
          <i className="bi bi-person-badge d-block mb-2" style={{ fontSize: '2rem' }} aria-hidden="true" />
          No staff yet. To add a teacher, open them in Students and switch on &quot;This is a teacher (staff)&quot;.
        </div>
      ) : (
        <ul className="list-group list-group-flush">
          {shown.length === 0 && <li className="list-group-item text-muted">Nobody matches that search.</li>}
          {shown.map((p) => {
            const wa = buildWaLink(p.id, '');
            return (
              <li key={`${p.__session}|${p.id}`} className="list-group-item staff-row" data-testid="staff-row">
                <div className="d-flex flex-wrap align-items-start justify-content-between gap-2">
                  <div className="staff-row-info">
                    <div className="fw-semibold">
                      {p.studentName || 'No name'}
                      <span className="badge text-bg-light border ms-2 fw-normal">{names[p.__session] ?? p.__session}</span>
                    </div>
                    <div className="small text-muted">
                      <span className="font-monospace">{p.id}</span>
                      {p.subjects ? <> · {p.subjects}</> : null}
                    </div>
                    {p.staffAt && <div className="small text-muted">Staff since {dateOf(p.staffAt)}</div>}
                  </div>
                  <div className="d-flex flex-wrap gap-1">
                    {wa.valid && (
                      <a className="btn btn-sm btn-outline-success" href={wa.url} target="_blank" rel="noopener noreferrer"
                        aria-label={`Message ${p.studentName || 'them'} on WhatsApp`}>
                        <i className="bi bi-whatsapp" aria-hidden="true" />
                      </a>
                    )}
                    <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setEditing(p)}>
                      <i className="bi bi-pencil me-1" aria-hidden="true" />Edit
                    </button>
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setBacking(p)}>
                      Back to student
                    </button>
                    <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setDeleting(p)}
                      aria-label={`Delete ${p.studentName || 'this staff member'}`}>
                      <i className="bi bi-trash" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <EditStaff
          person={editing}
          sessionDoc={docs[editing.__session] ?? null}
          onClose={() => setEditing(null)}
          onSave={(form) => onEdit(editing.__session, form.phone.trim(), { studentName: form.studentName, subjects: form.subjects }, editing.id)}
        />
      )}

      {backing && (
        <Modal title={`Set ${backing.studentName || 'them'} back to student?`} onClose={() => { if (!busy) setBacking(null); }}
          onConfirm={confirmBack} loading={busy} confirmLabel="Back to student">
          <p className="mb-0">
            {backing.studentName || 'They'} will be counted as a student again. They can be blocked and charged like
            other students. Their closed balance stays closed.
          </p>
        </Modal>
      )}

      {deleting && (
        <Modal title={`Delete ${deleting.studentName || 'this staff member'}?`} onClose={() => { if (!busy) setDeleting(null); }}
          onConfirm={confirmDelete} loading={busy} confirmLabel="Delete" type="danger">
          <p className="mb-0">Their record in {names[deleting.__session] ?? deleting.__session} and its notes are removed. This can&apos;t be undone.</p>
        </Modal>
      )}
    </section>
  );
}
