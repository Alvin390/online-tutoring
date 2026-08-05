import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSessions } from '@features/sessions/hooks/useSessions';
import { validateSlug, slugify, SESSION_ICONS, SESSION_GRADIENTS } from '@shared/constants/sessions';

/**
 * Session management — Phase 05 Part A.
 *
 * Create, rename, activate/deactivate, reorder and delete sessions.
 *
 * The slug is immutable after creation and the UI says so: it is the
 * registration URL students have been given, and it is the document ID. Letting
 * it be edited would silently invalidate every link and QR code already handed
 * out.
 *
 * Delete requires typing the session name AND offers reassignment, because
 * deleting a session takes its students and their private notes with it.
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
  const [form, setForm] = useState({ name: '', slug: '', icon: SESSION_ICONS[0], gradient: SESSION_GRADIENTS[0] });
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugError, setSlugError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const handleNameChange = (name) => {
    setForm((prev) => ({
      ...prev,
      name,
      // Auto-derive the slug until the teacher edits it themselves.
      slug: slugTouched ? prev.slug : slugify(name),
    }));
  };

  const handleCreate = async () => {
    const check = validateSlug(form.slug);
    if (!check.valid) {
      setSlugError(check.error);
      return;
    }
    setSlugError('');

    const result = await createSession({ ...form, slug: check.slug });
    if (result.success) {
      setForm({ name: '', slug: '', icon: SESSION_ICONS[0], gradient: SESSION_GRADIENTS[0] });
      setSlugTouched(false);
      setCreating(false);
    } else if (result.code === 'slug_taken' || result.code === 'invalid_slug') {
      setSlugError(result.message);
    }
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
        <button className="btn btn-sm btn-primary" onClick={() => setCreating(!creating)} disabled={busy}>
          <i className="bi bi-plus-lg me-1" aria-hidden="true" />
          New session
        </button>
      </div>

      <div className="card-body">
        {creating && (
          <div className="border rounded p-3 mb-3 bg-light">
            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label small fw-semibold" htmlFor="new-session-name">
                  Session name
                </label>
                <input
                  id="new-session-name"
                  className="form-control"
                  placeholder="e.g. Saturday Revision"
                  value={form.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  maxLength={60}
                />
              </div>

              <div className="col-md-6">
                <label className="form-label small fw-semibold" htmlFor="new-session-slug">
                  Registration link
                </label>
                <div className="input-group">
                  <span className="input-group-text small">{window.location.origin}/</span>
                  <input
                    id="new-session-slug"
                    className={`form-control ${slugError ? 'is-invalid' : ''}`}
                    value={form.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setForm({ ...form, slug: e.target.value });
                      setSlugError('');
                    }}
                    maxLength={40}
                    aria-describedby="slug-help"
                  />
                </div>
                {slugError ? (
                  <div className="text-danger small mt-1" role="alert">{slugError}</div>
                ) : (
                  <div id="slug-help" className="form-text">
                    This becomes the link you share. It cannot be changed later.
                  </div>
                )}
              </div>

              <div className="col-md-6">
                <label className="form-label small fw-semibold" htmlFor="new-session-icon">Icon</label>
                <select
                  id="new-session-icon"
                  className="form-select"
                  value={form.icon}
                  onChange={(e) => setForm({ ...form, icon: e.target.value })}
                >
                  {SESSION_ICONS.map((icon) => (
                    <option key={icon} value={icon}>{icon.replace('bi-', '').replace(/-/g, ' ')}</option>
                  ))}
                </select>
              </div>

              <div className="col-md-6">
                <label className="form-label small fw-semibold" htmlFor="new-session-colour">Colour</label>
                <select
                  id="new-session-colour"
                  className="form-select"
                  value={form.gradient}
                  onChange={(e) => setForm({ ...form, gradient: e.target.value })}
                >
                  {SESSION_GRADIENTS.map((g, i) => (
                    <option key={g} value={g}>Theme {i + 1}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="d-flex gap-2 mt-3">
              <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={busy || !form.name.trim()}>
                Create session
              </button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setCreating(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading && <div className="text-center py-3"><span className="spinner-border spinner-border-sm" /></div>}

        {!loading && sessions.length === 0 && (
          <p className="text-muted text-center py-3 mb-0">
            No sessions yet. Create one, or run <code>npm run seed:sessions</code> to set up the
            morning and evening defaults.
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
                  {renaming === session.id ? (
                    <div className="input-group input-group-sm">
                      <input
                        className="form-control"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        maxLength={60}
                        aria-label="Session name"
                      />
                      <button
                        className="btn btn-primary"
                        onClick={async () => {
                          await updateSession(session.id, { name: renameValue });
                          setRenaming(null);
                        }}
                        disabled={busy || !renameValue.trim()}
                      >
                        Save
                      </button>
                      <button className="btn btn-outline-secondary" onClick={() => setRenaming(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="fw-semibold">
                        {session.name}
                        {session.active === false && (
                          <span className="badge text-bg-secondary ms-2">Hidden</span>
                        )}
                      </div>
                      <small className="text-muted">/{session.id}</small>
                    </>
                  )}
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
                      setRenaming(session.id);
                      setRenameValue(session.name);
                    }}
                    disabled={busy}
                    aria-label={`Rename ${session.name}`}
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
