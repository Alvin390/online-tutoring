import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStudentNotes, RECOVERY_WINDOW_DAYS } from '../hooks/useStudentNotes';
import { highlight } from '@utils/highlight';

/**
 * Private notes for one student — Phase 05 Part B.
 *
 * The privacy guarantee is stated in the UI, not just in the rules, because the
 * teacher needs to know it to use the feature honestly.
 */

const DRAFT_PREFIX = 'note-draft:';

function formatDate(value) {
  const ms = value?.toMillis?.() ?? (typeof value === 'number' ? value : null);
  if (!ms) return 'Just now';
  return new Date(ms).toLocaleString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotesTab({ session, phone, studentName, active }) {
  const { notes, knownTags, loading, saving, addNote, editNote, deleteNote } = useStudentNotes({
    session,
    phone,
    enabled: active,
  });

  const draftKey = `${DRAFT_PREFIX}${session}:${phone}`;
  const [body, setBody] = useState('');
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const textareaRef = useRef(null);

  // Restore a half-written note. Losing one to an accidental drawer close is
  // the fastest way to make someone stop trusting the feature.
  useEffect(() => {
    if (!active) return;
    const saved = sessionStorage.getItem(draftKey);
    if (saved) setBody(saved);
  }, [active, draftKey]);

  useEffect(() => {
    if (!active) return;
    if (body) sessionStorage.setItem(draftKey, body);
    else sessionStorage.removeItem(draftKey);
  }, [body, draftKey, active]);

  // Debounced at 300ms so filtering does not run on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return notes;
    return notes.filter(
      (n) =>
        n.body?.toLowerCase().includes(term) ||
        (n.tags ?? []).some((t) => t.toLowerCase().includes(term))
    );
  }, [notes, debouncedSearch]);

  const commitTag = () => {
    const value = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (value && !tags.includes(value) && tags.length < 10) setTags([...tags, value]);
    setTagInput('');
  };

  const handleSave = async () => {
    const result = await addNote(body, tags);
    if (result.success) {
      setBody('');
      setTags([]);
      sessionStorage.removeItem(draftKey);
      textareaRef.current?.focus();
    }
  };

  const handleEditSave = async (noteId) => {
    const result = await editNote(noteId, editBody);
    if (result.success) setEditingId(null);
  };

  return (
    <div>
      {/* Composer */}
      <div className="mb-4">
        <label className="form-label fw-semibold" htmlFor="note-body">
          Add a note about {studentName || 'this student'}
        </label>
        <textarea
          id="note-body"
          ref={textareaRef}
          className="form-control"
          rows={3}
          placeholder="e.g. Struggling with quadratic equations. Parent asked for extra practice."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
        />

        <div className="d-flex flex-wrap gap-1 mt-2 align-items-center">
          {tags.map((tag) => (
            <span key={tag} className="badge text-bg-light text-dark border">
              {tag}
              <button
                type="button"
                className="btn-close btn-close-sm ms-1"
                style={{ fontSize: '0.5rem' }}
                onClick={() => setTags(tags.filter((t) => t !== tag))}
                aria-label={`Remove tag ${tag}`}
              />
            </span>
          ))}
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: 160 }}
            placeholder="Add a tag…"
            value={tagInput}
            list="known-tags"
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commitTag();
              }
            }}
            onBlur={commitTag}
            aria-label="Add a tag"
          />
          <datalist id="known-tags">
            {knownTags.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </div>

        <div className="d-flex justify-content-between align-items-center mt-2">
          <small className="text-muted">{body.length}/2000</small>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving || !body.trim()}
          >
            {saving ? <span className="spinner-border spinner-border-sm" /> : 'Save note'}
          </button>
        </div>
      </div>

      {/* Search */}
      {notes.length > 3 && (
        <div className="mb-3">
          <input
            type="search"
            className="form-control form-control-sm"
            placeholder="Search these notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search notes for this student"
          />
        </div>
      )}

      {/* List */}
      {loading && (
        <div className="text-center py-4">
          <span className="spinner-border spinner-border-sm text-muted" />
        </div>
      )}

      {!loading && notes.length === 0 && (
        <div className="text-center py-4 border rounded bg-light">
          <i className="bi bi-journal-text d-block mb-2 text-muted" style={{ fontSize: '1.75rem' }} aria-hidden="true" />
          <p className="fw-semibold mb-1">No notes yet</p>
          {/* The privacy guarantee, stated at the point of use. */}
          <p className="small text-muted mb-0">
            Notes are private to you and are never shown to students or parents.
          </p>
        </div>
      )}

      {!loading && notes.length > 0 && filtered.length === 0 && (
        <p className="text-muted small text-center py-3">
          No notes match &ldquo;{debouncedSearch}&rdquo;.
        </p>
      )}

      <AnimatePresence initial={false}>
        {filtered.map((note) => (
          <motion.div
            key={note.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="border rounded p-3 mb-2"
          >
            {editingId === note.id ? (
              <>
                <textarea
                  className="form-control mb-2"
                  rows={3}
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  maxLength={2000}
                  aria-label="Edit note"
                />
                <div className="d-flex gap-2">
                  <button className="btn btn-primary btn-sm" onClick={() => handleEditSave(note.id)} disabled={saving}>
                    Save
                  </button>
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* highlight() returns React nodes, never an HTML string. */}
                <p className="mb-2" style={{ whiteSpace: 'pre-wrap' }}>
                  {highlight(note.body, debouncedSearch)}
                </p>

                {(note.tags ?? []).length > 0 && (
                  <div className="d-flex flex-wrap gap-1 mb-2">
                    {note.tags.map((tag) => (
                      <span key={tag} className="badge text-bg-light text-dark border">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="d-flex justify-content-between align-items-center">
                  <small className="text-muted">
                    {formatDate(note.createdAt)}
                    {note.updatedAt && note.createdAt
                      && note.updatedAt.toMillis?.() > note.createdAt.toMillis?.() + 1000
                      && ' · edited'}
                  </small>

                  <div className="d-flex gap-1">
                    <button
                      className="btn btn-link btn-sm p-0 text-muted"
                      onClick={() => {
                        setEditingId(note.id);
                        setEditBody(note.body);
                      }}
                      aria-label="Edit this note"
                    >
                      <i className="bi bi-pencil" aria-hidden="true" />
                    </button>
                    <button
                      className="btn btn-link btn-sm p-0 text-danger"
                      onClick={() => setConfirmDelete(note.id)}
                      aria-label="Delete this note"
                    >
                      <i className="bi bi-trash" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {confirmDelete === note.id && (
                  <div className="alert alert-warning mt-2 mb-0 py-2 px-3">
                    <small className="d-block mb-2">
                      Delete this note? You can restore it for {RECOVERY_WINDOW_DAYS} days.
                    </small>
                    <div className="d-flex gap-2">
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={async () => {
                          await deleteNote(note.id);
                          setConfirmDelete(null);
                        }}
                      >
                        Delete
                      </button>
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
