import { memo, useEffect, useRef } from 'react';

const isTypingIn = (el) =>
  el instanceof HTMLElement
  && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * The student search box — 001Fixes / 04.
 *
 * Results follow as you type (no button, no minimum length). Keyboard:
 * "/" (when not typing elsewhere) or Ctrl/⌘+K focuses it; Esc clears it, a
 * second Esc leaves it; ↓ moves to the first result.
 */
function StudentSearchBar({ value, onChange, searching = false, onArrowDown }) {
  const inputRef = useRef(null);

  useEffect(() => {
    const onKeyDown = (e) => {
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingIn(e.target);
      const commandK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
      if (!slash && !commandK) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (value) onChange('');
      else inputRef.current?.blur();
    } else if (e.key === 'ArrowDown' && onArrowDown) {
      e.preventDefault();
      onArrowDown();
    }
  };

  return (
    <div className="student-search-bar position-relative">
      <i className="bi bi-search student-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="form-control student-search-input"
        placeholder="Search name, phone, subject or receipt…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        aria-label="Search students"
        aria-keyshortcuts="/ Control+K"
      />
      <span className="student-search-hint text-muted small" aria-hidden="true">
        {searching ? 'Searching…' : value ? '' : 'press /'}
      </span>
      {value && (
        <button
          type="button"
          className="btn btn-sm btn-link student-search-clear"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
        >
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default memo(StudentSearchBar);
