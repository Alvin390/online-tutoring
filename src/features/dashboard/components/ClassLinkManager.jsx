import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { parseClassLink, PROVIDER_META } from '@utils/classLink';

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
 */

const SESSION_META = {
  morning: { label: 'Morning Session', badge: 'morning-badge', icon: 'bi-sunrise-fill' },
  evening: { label: 'Evening Session', badge: 'evening-badge', icon: 'bi-moon-stars-fill' },
};

function LinkRow({ session, currentUrl, currentProvider, lastUpdated, onUpdate, loading }) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const meta = SESSION_META[session];

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
    await onUpdate(session, parsed.url);
  };

  const providerBadge = detected ?? currentProvider;

  return (
    <div className="link-input-group mb-4">
      <label className="form-label fw-semibold mb-3 d-flex align-items-center gap-2 flex-wrap">
        <span className={`session-badge ${meta.badge}`}>
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
          type="url"
          className={`form-control ${showError ? 'is-invalid' : ''}`}
          placeholder="Paste a Zoom or Google Meet link"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-label={`${meta.label} class link`}
          aria-invalid={showError ? 'true' : 'false'}
          aria-describedby={showError ? `${session}-link-error` : `${session}-link-help`}
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
        <div id={`${session}-link-error`} className="text-danger small" role="alert">
          {parsed.error}
        </div>
      ) : (
        <div id={`${session}-link-help`} className="form-text">
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

export default function ClassLinkManager({ zoomLinks, onUpdate, loading }) {
  const showWarning = !zoomLinks.morning || !zoomLinks.evening;

  const copy = (path) => {
    navigator.clipboard.writeText(`${window.location.origin}${path}`);
  };

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
        {showWarning && (
          <div className="alert alert-warning mb-4" role="alert">
            <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
            <strong>Setup Required:</strong> Add your class links before sharing
            registration links with students.
          </div>
        )}

        <LinkRow
          session="morning"
          currentUrl={zoomLinks.morning}
          currentProvider={zoomLinks.morningProvider}
          lastUpdated={zoomLinks.morningLastUpdated}
          onUpdate={onUpdate}
          loading={loading}
        />

        <LinkRow
          session="evening"
          currentUrl={zoomLinks.evening}
          currentProvider={zoomLinks.eveningProvider}
          lastUpdated={zoomLinks.eveningLastUpdated}
          onUpdate={onUpdate}
          loading={loading}
        />

        <div className="alert alert-info mt-4 mb-0">
          <h6 className="fw-bold mb-3">
            <i className="bi bi-clipboard-check me-2" aria-hidden="true" />
            Share Registration Links with Students
          </h6>
          <div className="row g-3">
            {['morning', 'evening'].map((session) => (
              <div className="col-md-6" key={session}>
                <label className="small text-muted mb-2" htmlFor={`share-${session}`}>
                  {SESSION_META[session].label} Link:
                </label>
                <div className="input-group">
                  <input
                    id={`share-${session}`}
                    type="text"
                    className="form-control"
                    value={`${window.location.origin}/${session}`}
                    readOnly
                  />
                  <button
                    className="btn copy-link-btn"
                    onClick={() => copy(`/${session}`)}
                    aria-label={`Copy ${SESSION_META[session].label} registration link`}
                  >
                    <i className="bi bi-clipboard" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
