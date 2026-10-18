import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { parseClassLink, PROVIDER_META } from '@utils/classLink';
import { DEFAULT_SESSION_ICON, DEFAULT_SESSION_GRADIENT } from '@shared/constants/sessions';
import '@/styles/landing.css';

/**
 * Class link management — Phase 04 Part B.
 *
 * Replaces ZoomLinkManager. Accepts Zoom and Google Meet, detects which from
 * the URL on paste, and shows the matching icon and label. No provider
 * dropdown: the URL already says which it is, and a dropdown that can disagree
 * with the link is a field that will eventually be wrong.
 *
 * Validation here is inline UX. The control is `/api/class/setLink`, which
 * re-parses with the server copy, plus a shape check in firestore.rules.
 *
 * Phase 13 / 02 D4: one link slot PER SESSION, driven by the session list —
 * a session created in the Sessions panel gets its slot here immediately, with
 * no reload and no code change. Hidden sessions keep a slot too (collapsed),
 * so a link can be ready before a session opens.
 */

function LinkRow({ session, currentUrl, currentProvider, lastUpdated, onUpdate, loading }) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const meta = {
    label: session.name,
    icon: session.icon ?? DEFAULT_SESSION_ICON,
    gradient: session.gradient ?? DEFAULT_SESSION_GRADIENT,
  };
  const id = session.id;

  useEffect(() => {
    setValue(currentUrl || '');
    setTouched(false);
  }, [currentUrl]);

  // Live parse as the teacher types, so the provider badge appears on paste.
  const parsed = useMemo(() => (value.trim() ? parseClassLink(value) : null), [value]);
  const showError = touched && parsed && !parsed.valid;
  const detected = parsed?.valid ? parsed.provider : null;

  const handleSubmit = async () => {
    setTouched(true);
    if (!parsed?.valid) return;
    await onUpdate(id, parsed.url);
  };

  const providerBadge = detected ?? currentProvider;

  return (
    <div className="link-input-group mb-4" data-testid={`link-row-${id}`}>
      <label className="form-label fw-semibold mb-3 d-flex align-items-center gap-2 flex-wrap" htmlFor={`${id}-link`}>
        <span className="session-badge" style={{ '--card-gradient': meta.gradient }}>
          <i className={`bi ${meta.icon} me-1`} aria-hidden="true" />
          {meta.label}
        </span>

        {providerBadge && (
          <span className="badge text-bg-light text-dark border">
            <i className={`bi ${PROVIDER_META[providerBadge]?.icon} me-1`} aria-hidden="true" />
            {PROVIDER_META[providerBadge]?.label}
          </span>
        )}
      </label>

      <div className="input-group input-group-lg mb-2">
        <span className="input-group-text">
          <i
            className={`bi ${detected ? PROVIDER_META[detected].icon : 'bi-link-45deg'}`}
            aria-hidden="true"
          />
        </span>
        <input
          id={`${id}-link`}
          type="url"
          className={`form-control ${showError ? 'is-invalid' : ''}`}
          placeholder="Paste a Zoom or Google Meet link"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-label={`${meta.label} class link`}
          aria-invalid={showError ? 'true' : 'false'}
          aria-describedby={showError ? `${id}-link-error` : `${id}-link-help`}
        />
        <button
          className={`btn ${currentUrl ? 'btn-success' : 'btn-primary'}`}
          style={{ minWidth: '130px' }}
          onClick={handleSubmit}
          disabled={loading || !value.trim()}
        >
          {loading ? (
            <span className="spinner-border spinner-border-sm" />
          ) : (
            <>
              <i className={`bi bi-${currentUrl ? 'arrow-repeat' : 'plus-circle'} me-1`} aria-hidden="true" />
              {currentUrl ? 'Update' : 'Add'} Link
            </>
          )}
        </button>
      </div>

      {showError ? (
        <div id={`${id}-link-error`} className="text-danger small" role="alert">
          {parsed.error}
        </div>
      ) : (
        <div id={`${id}-link-help`} className="form-text">
          Zoom or Google Meet — e.g. {PROVIDER_META.zoom.example} or {PROVIDER_META.meet.example}
        </div>
      )}

      <small className="text-muted d-block mt-1">
        <i className="bi bi-clock me-1" aria-hidden="true" />
        Last updated:{' '}
        {lastUpdated
          ? new Date(lastUpdated?.toDate?.() ?? lastUpdated).toLocaleString()
          : 'Not set'}
      </small>
    </div>
  );
}

export default function ClassLinkManager({ sessions = [], classLinks = {}, onUpdate, loading }) {
  const active = sessions.filter((s) => s.active !== false);
  const hidden = sessions.filter((s) => s.active === false);
  const missing = active.filter((s) => !classLinks[s.id]?.url);
  const [showHidden, setShowHidden] = useState(false);

  const copy = (path) => {
    navigator.clipboard?.writeText(`${window.location.origin}${path}`);
  };

  const row = (session) => (
    <LinkRow
      key={session.id}
      session={session}
      currentUrl={classLinks[session.id]?.url ?? ''}
      currentProvider={classLinks[session.id]?.provider ?? null}
      lastUpdated={classLinks[session.id]?.updatedAt ?? null}
      onUpdate={onUpdate}
      loading={loading}
    />
  );

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card mb-4">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">
          <i className="bi bi-link-45deg me-2" aria-hidden="true" />
          Class Link Management
        </h5>
        <span className="badge bg-primary">Essential Setup</span>
      </div>

      <div className="card-body p-4">
        {missing.length > 0 && (
          <div className="alert alert-warning mb-4" role="alert">
            <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
            <strong>Setup Required:</strong>{' '}
            {missing.length === 1
              ? `${missing[0].name} has no class link yet.`
              : `${missing.length} sessions have no class link yet.`}{' '}
            Add them before sharing registration links with students.
          </div>
        )}

        {active.map(row)}

        {hidden.length > 0 && (
          <div className="mb-4">
            <button
              type="button"
              className="btn btn-link px-0 text-decoration-none"
              aria-expanded={showHidden}
              onClick={() => setShowHidden((v) => !v)}
            >
              <i className={`bi bi-chevron-${showHidden ? 'down' : 'right'} me-1`} aria-hidden="true" />
              Hidden sessions ({hidden.length})
            </button>
            {showHidden && <div className="mt-3">{hidden.map(row)}</div>}
          </div>
        )}

        {active.length > 0 && (
          <div className="alert alert-info mt-4 mb-0">
            <h6 className="fw-bold mb-3">
              <i className="bi bi-clipboard-check me-2" aria-hidden="true" />
              Share Registration Links with Students
            </h6>
            <div className="row g-3">
              {active.map((session) => (
                <div className="col-md-6" key={session.id}>
                  <label className="small text-muted mb-2" htmlFor={`share-${session.id}`}>
                    {session.name} Link:
                  </label>
                  <div className="input-group">
                    <input
                      id={`share-${session.id}`}
                      type="text"
                      className="form-control"
                      value={`${window.location.origin}/${session.id}`}
                      readOnly
                    />
                    <button
                      type="button"
                      className="btn copy-link-btn"
                      onClick={() => copy(`/${session.id}`)}
                      aria-label={`Copy ${session.name} registration link`}
                    >
                      <i className="bi bi-clipboard" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
