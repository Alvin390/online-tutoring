import { useRef, useState } from 'react';
import { PLACEHOLDERS, STARTERS, stripUnsupported } from '../smsDraft';

/**
 * The message box — 008Fixes / 09. A short guide above neat placeholder
 * buttons (owner: easier than typing `{{…}}`), starter messages, and for SMS
 * every emoji (or other character SMS can't carry) removed as it is typed,
 * with a one-line notice saying so.
 */
export default function MessageBox({ value, onChange, sms = true, feesOn = false, schoolName = '', starters: showStarters = true, children }) {
  const ref = useRef(null);
  const [removed, setRemoved] = useState([]);
  const buttons = PLACEHOLDERS.filter((p) => (!p.fees || feesOn) && (p.token !== 'schoolName' || schoolName));
  const starters = STARTERS.filter((s) => !s.fees || feesOn);

  const set = (text) => {
    if (!sms) { onChange(text); return; }
    const clean = stripUnsupported(text);
    setRemoved(clean.removed);
    onChange(clean.text);
  };

  const insert = (label) => {
    const el = ref.current;
    const token = `[${label}]`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    set(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="message-box">
      <div className="mb-2">
        <div className="small text-muted mb-1" id="placeholder-guide">
          Tap a button to add details that change for each parent. For example, <strong>[Student name]</strong> becomes
          &quot;Amina&quot; in Amina&apos;s parent&apos;s message.
        </div>
        <div className="d-flex flex-wrap gap-1" role="group" aria-label="Add a detail" aria-describedby="placeholder-guide">
          {buttons.map((p) => (
            <button key={p.token} type="button" className="btn btn-sm btn-outline-primary rounded-pill" onClick={() => insert(p.label)}>
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />{p.label}
            </button>
          ))}
        </div>
      </div>
      <label className="form-label fw-semibold mb-1" htmlFor="message-text">Message</label>
      <textarea
        id="message-text"
        ref={ref}
        className="form-control"
        rows={5}
        value={value}
        placeholder={sms ? 'Write your message, or start from one below.' : 'Write your message.'}
        onChange={(e) => set(e.target.value)}
      />
      {removed.length > 0 && (
        <div className="small text-danger mt-1" role="status">
          Removed {removed.join(' ')}: emoji can&apos;t be sent by SMS.
        </div>
      )}
      {children}
      {showStarters && !value.trim() && (
        <div className="mt-2">
          <span className="small text-muted me-2">Start from:</span>
          {starters.map((s) => (
            <button key={s.id} type="button" className="btn btn-sm btn-light border me-1 mb-1" onClick={() => set(s.text)}>{s.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
