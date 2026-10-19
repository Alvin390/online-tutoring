import { lazy, Suspense, useState } from 'react';

// Lazy: the form, the screenshot pipeline and its worker cost nothing until
// a teacher actually opens it.
const HelpFeedbackModal = lazy(() => import('./HelpFeedbackModal'));

/** "Help & feedback" entry point — dashboard header and billing page. */
export default function HelpFeedbackButton({ className = 'btn btn-outline-light' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} title="Report a problem or suggest a feature">
        <i className="bi bi-life-preserver me-1" aria-hidden="true" />
        Help &amp; feedback
      </button>
      {open && (
        <Suspense fallback={null}>
          <HelpFeedbackModal onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
