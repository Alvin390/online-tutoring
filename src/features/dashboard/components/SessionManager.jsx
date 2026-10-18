import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSessions } from '@features/sessions/hooks/useSessions';
import SessionEditor from '@features/sessions/components/SessionEditor';
import { formatSchedule } from '@utils/formatSchedule';

/**
 * Session management — Phase 05 Part A; full editing since Phase 13 / 02 D8.
 *
 * Create, edit, show/hide, reorder and delete sessions. Morning and evening are
 * created automatically (server-side, once) and are ordinary sessions: the
 * pencil opens the same editor for them as for any session the teacher adds —
 * name, description, days and times, icon, colour and homepage visibility,
 * with a live preview of the homepage card.
 *
 * The slug is immutable after creation and the UI says so: it is the
 * registration URL students have been given, and it is the document ID.
 *
 * Delete requires typing the session name AND offers reassignment, because
 * deleting a session takes its students and their private notes with it. A
 * deleted default session is not recreated.
 */
export default function SessionManager() {
  const {
    sessions,
    loading,
    busy,
    createSession,
    updateSession,
    deleteSession,
    toggleActive,
    reorderSessions,
  } = useSessions();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editorError, setEditorError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [reassignTo, setReassignTo] = useState('');

  const handleCreate = async (payload) => {
    setEditorError('');
    const result = await createSession(payload);
    if (result.success) setCreating(false);
    else setEditorError(result.message ?? 'Could not create the session.');
  };

  const handleEdit = (slug) => async (patch) => {
    setEditorError('');
    const result = await updateSession(slug, patch);
    if (result.success) setEditing(null);
    else setEditorError(result.message ?? 'Could not save the session.');
  };

  const handleDelete = async () => {
    const result = await deleteSession(deleting.id, confirmText, reassignTo || null);
    if (result.success) {
      setDeleting(null);
      setConfirmText('');
      setReassignTo('');
    }
  };

  const move = (index, direction) => {
    const next = [...sessions];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorderSessions(next.map((s) => s.id));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card mb-4">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">
          <i className="bi bi-calendar3 me-2" aria-hidden="true" />
          Sessions
        </h5>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            setCreating(!creating);
            setEditing(null);
            setEditorError('');
          }}
          disabled={busy}
        >
          <i className="bi bi-plus-lg me-1" aria-hidden="true" />
          New session
        </button>
      </div>

      <div className="card-body">
        {creating && (
          <SessionEditor
            onSave={handleCreate}
            onCancel={() => setCreating(false)}
            busy={busy}
            serverError={editorError}
          />
        )}

        {loading && <div className="text-center py-3"><span className="spinner-border spinner-border-sm" /></div>}

        {!loading && sessions.length === 0 && (
          <p className="text-muted text-center py-3 mb-0">
            Setting up your default sessions — this takes a moment the first time.
          </p>
        )}

        <ul className="list-group list-group-flush">
          {sessions.map((session, index) => (
            <li key={session.id} className="list-group-item px-0">
              <div className="d-flex align-items-center gap-3 flex-wrap">
                <div
                  className="rounded d-flex align-items-center justify-content-center text-white flex-shrink-0"
                  style={{ width: 40, height: 40, background: session.gradient }}
                  aria-hidden="true"
                >
                  <i className={`bi ${session.icon}`} />
                </div>

                <div className="flex-grow-1" style={{ minWidth: 180 }}>
                  <div className="fw-semibold">
                    {session.name}
                    {session.active === false && (
                      <span className="badge text-bg-secondary ms-2">Hidden</span>
                    )}
                  </div>
                  <small className="text-muted">
                    /{session.id}
                    {formatSchedule(session.schedule) && ` · ${formatSchedule(session.schedule)}`}
                  </small>
                </div>

                <div className="btn-group btn-group-sm">
                  <button
                    className="btn btn-outline-secondary"
                    onClick={() => move(index, -1)}
                    disabled={busy || index === 0}
                    aria-label={`Move ${session.name} up`}
                  >
                    <i className="bi bi-arrow-up" aria-hidden="true" />
                  </button>
                  <button
                    className="btn btn-outline-secondary"
                    onClick={() => move(index, 1)}
                    disabled={busy || index === sessions.length - 1}
                    aria-label={`Move ${session.name} down`}
                  >
                    <i className="bi bi-arrow-down" aria-hidden="true" />
                  </button>
                  <button
                    className="btn btn-outline-secondary"
                    onClick={() => {
                      setEditing(editing === session.id ? null : session.id);
                      setCreating(false);
                      setEditorError('');
                    }}
                    disabled={busy}
                    aria-label={`Edit ${session.name}`}
                    aria-expanded={editing === session.id}
                  >
                    <i className="bi bi-pencil" aria-hidden="true" />
                  </button>
                  <button
                    className="btn btn-outline-secondary"
                    onClick={() => toggleActive(session)}
                    disabled={busy}
                    aria-label={session.active === false ? `Show ${session.name}` : `Hide ${session.name}`}
                  >
                    <i className={`bi ${session.active === false ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" />
                  </button>
                  <button
                    className="btn btn-outline-danger"
                    onClick={() => {
                      setDeleting(session);
                      setConfirmText('');
                      setReassignTo('');
                    }}
                    disabled={busy}
                    aria-label={`Delete ${session.name}`}
                  >
                    <i className="bi bi-trash" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {editing === session.id && (
                <div className="mt-3">
                  <SessionEditor
                    session={session}
                    onSave={handleEdit(session.id)}
                    onCancel={() => setEditing(null)}
                    busy={busy}
                    serverError={editorError}
                  />
                </div>
              )}

              {deleting?.id === session.id && (
                <div className="alert alert-danger mt-3 mb-0">
                  <h6 className="fw-bold">Delete &ldquo;{session.name}&rdquo;?</h6>
                  <p className="small mb-3">
                    This removes the session, <strong>every student in it</strong>, and{' '}
                    <strong>all private notes about them</strong>. It cannot be undone.
                  </p>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold" htmlFor={`reassign-${session.id}`}>
                      Move students to another session first (optional)
                    </label>
                    <select
                      id={`reassign-${session.id}`}
                      className="form-select form-select-sm"
                      value={reassignTo}
                      onChange={(e) => setReassignTo(e.target.value)}
                    >
                      <option value="">Don&apos;t move them — delete everything</option>
                      {sessions
                        .filter((s) => s.id !== session.id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold" htmlFor={`confirm-${session.id}`}>
                      Type <code>{session.name}</code> to confirm
                    </label>
                    <input
                      id={`confirm-${session.id}`}
                      className="form-control form-control-sm"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      autoComplete="off"
                    />
                  </div>

                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={handleDelete}
                      disabled={busy || confirmText !== session.name}
                    >
                      Delete session
                    </button>
                    <button
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => setDeleting(null)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}
