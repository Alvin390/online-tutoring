import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export default function ZoomLinkManager({ zoomLinks, onUpdate, loading }) {
  const [morningLink, setMorningLink] = useState('');
  const [eveningLink, setEveningLink] = useState('');
  const [errors, setErrors] = useState({});

  // Update local state when zoomLinks prop changes
  useEffect(() => {
    setMorningLink(zoomLinks.morning || '');
    setEveningLink(zoomLinks.evening || '');
  }, [zoomLinks]);

  const validateZoomLink = (url) => {
    if (!url || url.trim() === '') {
      return 'Please enter a Zoom link';
    }
    try {
      const urlObj = new URL(url);
      if (!urlObj.hostname.includes('zoom.us')) {
        return 'Please enter a valid Zoom meeting link (zoom.us)';
      }
      return null;
    } catch (e) {
      return 'Please enter a valid URL';
    }
  };

  const handleUpdate = async (session, url) => {
    const error = validateZoomLink(url);
    if (error) {
      setErrors(prev => ({ ...prev, [session]: error }));
      return;
    }

    setErrors(prev => ({ ...prev, [session]: null }));
    await onUpdate(session, url);
  };

  const showWarning = !zoomLinks.morning || !zoomLinks.evening;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="card mb-4"
    >
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">
          <i className="bi bi-link-45deg me-2" />
          Zoom Link Management
        </h5>
        <span className="badge bg-primary">Essential Setup</span>
      </div>

      <div className="card-body p-4">
        {showWarning && (
          <div className="alert alert-warning mb-4">
            <i className="bi bi-exclamation-triangle me-2" />
            <strong>Setup Required:</strong> Add your Zoom meeting links before sharing
            registration links with students.
          </div>
        )}

        {/* Morning Link */}
        <div className="link-input-group mb-4">
          <label className="form-label fw-semibold mb-3">
            <span className="session-badge morning-badge me-2">
              <i className="bi bi-sunrise-fill me-1" />
              Morning Session
            </span>
          </label>
          <div className="input-group input-group-lg mb-2">
            <span className="input-group-text">
              <i className="bi bi-camera-video" />
            </span>
            <input
              type="url"
              className={`form-control ${errors.morning ? 'is-invalid' : ''}`}
              placeholder="https://zoom.us/j/123456789?pwd=..."
              value={morningLink}
              onChange={(e) => setMorningLink(e.target.value)}
            />
            <button
              className={`btn ${zoomLinks.morning ? 'btn-success' : 'btn-primary'}`}
              style={{ minWidth: '130px' }}
              onClick={() => handleUpdate('morning', morningLink)}
              disabled={loading}
            >
              {loading ? (
                <span className="spinner-border spinner-border-sm" />
              ) : (
                <>
                  <i className={`bi bi-${zoomLinks.morning ? 'arrow-repeat' : 'plus-circle'} me-1`} />
                  {zoomLinks.morning ? 'Update' : 'Add'} Link
                </>
              )}
            </button>
          </div>
          {errors.morning && (
            <div className="text-danger small">{errors.morning}</div>
          )}
          <small className="text-muted">
            <i className="bi bi-clock me-1" />
            Last updated: {zoomLinks.morningLastUpdated
              ? new Date(zoomLinks.morningLastUpdated).toLocaleString()
              : 'Not set'}
          </small>
        </div>

        {/* Evening Link */}
        <div className="link-input-group">
          <label className="form-label fw-semibold mb-3">
            <span className="session-badge evening-badge me-2">
              <i className="bi bi-moon-stars-fill me-1" />
              Evening Session
            </span>
          </label>
          <div className="input-group input-group-lg mb-2">
            <span className="input-group-text">
              <i className="bi bi-camera-video" />
            </span>
            <input
              type="url"
              className={`form-control ${errors.evening ? 'is-invalid' : ''}`}
              placeholder="https://zoom.us/j/987654321?pwd=..."
              value={eveningLink}
              onChange={(e) => setEveningLink(e.target.value)}
            />
            <button
              className={`btn ${zoomLinks.evening ? 'btn-success' : 'btn-primary'}`}
              style={{ minWidth: '130px' }}
              onClick={() => handleUpdate('evening', eveningLink)}
              disabled={loading}
            >
              {loading ? (
                <span className="spinner-border spinner-border-sm" />
              ) : (
                <>
                  <i className={`bi bi-${zoomLinks.evening ? 'arrow-repeat' : 'plus-circle'} me-1`} />
                  {zoomLinks.evening ? 'Update' : 'Add'} Link
                </>
              )}
            </button>
          </div>
          {errors.evening && (
            <div className="text-danger small">{errors.evening}</div>
          )}
          <small className="text-muted">
            <i className="bi bi-clock me-1" />
            Last updated: {zoomLinks.eveningLastUpdated
              ? new Date(zoomLinks.eveningLastUpdated).toLocaleString()
              : 'Not set'}
          </small>
        </div>

        {/* Registration Links */}
        <div className="alert alert-info mt-4 mb-0">
          <h6 className="fw-bold mb-3">
            <i className="bi bi-clipboard-check me-2" />
            Share Registration Links with Students
          </h6>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="small text-muted mb-2">Morning Session Link:</label>
              <div className="input-group">
                <input
                  type="text"
                  className="form-control"
                  value={`${window.location.origin}/morning`}
                  readOnly
                />
                <button
                  className="btn copy-link-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/morning`);
                  }}
                >
                  <i className="bi bi-clipboard" />
                </button>
              </div>
            </div>
            <div className="col-md-6">
              <label className="small text-muted mb-2">Evening Session Link:</label>
              <div className="input-group">
                <input
                  type="text"
                  className="form-control"
                  value={`${window.location.origin}/evening`}
                  readOnly
                />
                <button
                  className="btn copy-link-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/evening`);
                  }}
                >
                  <i className="bi bi-clipboard" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
