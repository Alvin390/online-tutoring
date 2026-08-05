import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { buildWaLink, maskForDisplay, estimateDuration } from '@utils/waLink';
import { renderTemplate, appendAttachments } from '@utils/messageTemplate';

/**
 * The send queue — Phase 08 D4. The heart of this phase.
 *
 * WHY IT IS A QUEUE AND NOT A "SEND ALL" BUTTON:
 * browsers permit one `window.open` per user gesture. A loop over 40 recipients
 * opens the first and silently drops 39. There is no flag, no permission and no
 * workaround — so sending is a guided sequence, one real click per recipient.
 *
 * The critical implementation detail: **"Open WhatsApp" is a real `<a
 * target="_blank">`, not a scripted `window.open`.** A genuine user click on an
 * anchor is never popup-blocked, and it also sidesteps any interaction with the
 * Cross-Origin-Opener-Policy header set in Phase 01. Turning this into a button
 * with an onClick handler that calls window.open would reintroduce exactly the
 * problem the queue exists to avoid.
 *
 * Resumable: position is derived from server-side recipient status, so closing
 * the tab and coming back continues where it left off. For a 60-student
 * broadcast that is essential, not a nicety.
 */
export default function SendQueue({
  campaign,
  recipients,
  onMark,
  onComplete,
  onAbandon,
  busy,
}) {
  const [skipping, setSkipping] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const anchorRef = useRef(null);

  const pending = useMemo(
    () => recipients.filter((r) => r.status === 'queued' || r.status === 'opened'),
    [recipients]
  );

  const current = pending[0] ?? null;

  const sent = recipients.filter((r) => r.status === 'sent').length;
  const skipped = recipients.filter((r) => r.status === 'skipped').length;
  const remaining = pending.length;
  const total = recipients.length;
  const progress = total > 0 ? Math.round(((sent + skipped) / total) * 100) : 0;

  const message = useMemo(() => {
    if (!current) return '';
    const rendered = renderTemplate(campaign.messageTemplate, current);
    return appendAttachments(rendered, campaign.attachments ?? []);
  }, [current, campaign]);

  const link = useMemo(
    () => (current ? buildWaLink(current.phone, message) : { valid: false }),
    [current, message]
  );

  /** Keyboard operation — Enter to send, S to skip. */
  const handleKey = useCallback(
    (event) => {
      if (busy || !current) return;
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

      if (event.key === 'Enter') {
        event.preventDefault();
        anchorRef.current?.click();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        setSkipping(true);
      }
    },
    [busy, current]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  const handleOpened = () => {
    // Marked 'opened' rather than 'sent': clicking the link proves WhatsApp was
    // launched, not that a message left the device. The teacher confirms.
    onMark(current.phone, 'opened');
  };

  if (!current) {
    return (
      <div className="text-center py-4">
        <i className="bi bi-check-circle-fill text-success d-block mb-2" style={{ fontSize: '2.5rem' }} aria-hidden="true" />
        <h3 className="h5 fw-bold">Queue finished</h3>
        <p className="text-muted">
          {sent} sent · {skipped} skipped out of {total}
        </p>
        <button className="btn btn-primary" onClick={onComplete} disabled={busy}>
          Close campaign
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h3 className="h6 fw-bold mb-0">Sending: {campaign.title}</h3>
        <span className="small text-muted">
          {sent + skipped} / {total}
        </span>
      </div>

      <div
        className="progress mb-3"
        style={{ height: 8 }}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Campaign progress"
      >
        <div className="progress-bar" style={{ width: `${progress}%` }} />
      </div>

      {/* Honest expectation-setting, per the plan. */}
      <p className="small text-muted">
        WhatsApp opens once per recipient — {estimateDuration(remaining)} left for the
        remaining {remaining}.
      </p>

      <div className="border rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-start mb-2">
          <div>
            <div className="fw-bold">{current.studentName ?? 'Student'}</div>
            <div className="small text-muted">
              {maskForDisplay(current.phone)}
              {current.class && ` · ${current.class}`}
            </div>
          </div>
          <span className="badge text-bg-light text-muted">Next</span>
        </div>

        <div
          className="bg-light rounded p-2 small"
          style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}
        >
          {message}
        </div>

        {!link.valid && (
          <div className="alert alert-danger mt-2 mb-0 py-2 px-3 small" role="alert">
            {link.error} — skip this one and fix the number afterwards.
          </div>
        )}
      </div>

      <div className="d-flex gap-2 flex-wrap">
        {/*
          A REAL ANCHOR. Not a button calling window.open — that is what gets
          popup-blocked, and it is the single most important line in this file.
        */}
        <a
          ref={anchorRef}
          href={link.valid ? link.url : undefined}
          target="_blank"
          rel="noopener noreferrer"
          className={`btn btn-success ${link.valid ? '' : 'disabled'}`}
          onClick={link.valid ? handleOpened : (e) => e.preventDefault()}
          aria-disabled={!link.valid}
        >
          <i className="bi bi-whatsapp me-2" aria-hidden="true" />
          Open WhatsApp &amp; send
        </a>

        <button
          className="btn btn-outline-secondary"
          onClick={() => setSkipping(true)}
          disabled={busy}
        >
          Skip
        </button>

        <button className="btn btn-link text-muted ms-auto" onClick={onAbandon} disabled={busy}>
          Pause — resume later
        </button>
      </div>

      {/* Shown after the link is clicked: the teacher confirms it actually sent. */}
      {current.status === 'opened' && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="alert alert-info mt-3 mb-0 d-flex align-items-center gap-2 flex-wrap"
        >
          <span className="fw-semibold">Did it send?</span>
          <button
            className="btn btn-success btn-sm"
            onClick={() => onMark(current.phone, 'sent')}
            disabled={busy}
          >
            Yes, sent
          </button>
          <button
            className="btn btn-outline-secondary btn-sm"
            onClick={() => anchorRef.current?.click()}
            disabled={busy}
          >
            Try again
          </button>
        </motion.div>
      )}

      {skipping && (
        <div className="border rounded p-2 mt-3">
          <label className="form-label small fw-semibold" htmlFor="skip-reason">
            Why are you skipping {current.studentName ?? 'this student'}?
          </label>
          <select
            id="skip-reason"
            className="form-select form-select-sm mb-2"
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
          >
            <option value="">Choose a reason…</option>
            <option value="wrong_number">Wrong number</option>
            <option value="no_whatsapp">Not on WhatsApp</option>
            <option value="opted_out">Asked not to be messaged</option>
            <option value="other">Other</option>
          </select>
          <div className="d-flex gap-2">
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !skipReason}
              onClick={() => {
                onMark(current.phone, 'skipped', skipReason);
                setSkipping(false);
                setSkipReason('');
              }}
            >
              Skip
            </button>
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setSkipping(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="small text-muted mt-3 mb-0">
        Keyboard: <kbd>Enter</kbd> to open WhatsApp, <kbd>S</kbd> to skip.
      </p>
    </div>
  );
}
