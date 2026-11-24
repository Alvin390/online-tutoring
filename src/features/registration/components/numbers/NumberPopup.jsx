import { useRef, useState } from 'react';
import Modal from '@shared/components/ui/Modal';
import Rich from './Rich';
import { NUMBER_POPUP as COPY } from './numberCopy';

/**
 * The number the school gave — 014Fixes / 04 (owner, 2026-11-24): big, for
 * which SESSION, a Copy button, "Don't forget it… also sent by SMS". Closed
 * only by its own button (never a tap outside or Escape: it must be read).
 *
 * `afterApproval` (phase 06): the button says just "I've saved it" when the
 * student waits for the teacher next instead of going to class.
 */
export default function NumberPopup({ kind = 'student', display, session, afterApproval = false, onDone }) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState(false);
  const numberRef = useRef(null);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(display);
      setCopied(true);
      setFallback(false);
    } catch {
      // No clipboard (an old phone, or permission refused): select it instead.
      setFallback(true);
      const node = numberRef.current;
      const selection = window.getSelection?.();
      if (node && selection && document.createRange) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

  return (
    <Modal
      title={COPY.title(kind)}
      dismissible={false}
      onClose={() => {}}
      footer={(
        <button type="button" className="btn btn-primary btn-lg w-100" onClick={onDone}>
          {afterApproval ? COPY.saved : COPY.goToClass}
        </button>
      )}
    >
      <div className="text-center" data-testid="number-popup">
        <p
          ref={numberRef}
          className="display-4 fw-bold mb-2"
          style={{ letterSpacing: '0.15em', userSelect: 'all' }}
          data-testid="number-popup-number"
        >
          {display}
        </p>
        <p className="mb-3"><Rich text={COPY.forSession(kind, session)} /></p>
        <button type="button" className="btn btn-outline-primary mb-2" onClick={copy}>
          <i className={`bi ${copied ? 'bi-check2' : 'bi-clipboard'} me-2`} aria-hidden="true" />
          {copied ? COPY.copied : COPY.copy}
        </button>
        {fallback && <p className="small text-muted mb-2" role="status">{COPY.copyFallback}</p>}
        <p className="alert alert-warning small text-start mb-0" role="note"><Rich text={COPY.remember} /></p>
      </div>
    </Modal>
  );
}
