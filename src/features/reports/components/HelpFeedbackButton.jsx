import { lazy, Suspense, useState } from 'react';

// Lazy: the form, the screenshot pipeline and its worker cost nothing until
// a teacher actually opens it.
const HelpFeedbackModal = lazy(() => import('./HelpFeedbackModal'));

/** "Help & feedback" entry point — dashboard header and billing page. */
export default function HelpFeedbackButton({ className = 'btn btn-outline-light', compact = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        title="Report a problem or suggest a feature"
        aria-label={compact ? 'Help & feedback' : undefined}
      >
        <i className={`bi bi-life-preserver ${compact ? 'me-sm-1' : 'me-1'}`} aria-hidden="true" />
        {/* compact: icon only on phones, so the dashboard header fits */}
        {compact ? <span className="d-none d-sm-inline">Help &amp; feedback</span> : 'Help & feedback'}
      </button>
      {open && (
        <Suspense fallback={null}>
          <HelpFeedbackModal onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
