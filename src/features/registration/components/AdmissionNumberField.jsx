import { useEffect, useRef, useState, useId } from 'react';
import { checkNumber } from '@services/api/studentAdmission';
import { numberProblem, numberProblemMessage } from '@utils/admissionNumber';

/**
 * The "choose your 4-digit number" field with a live check — 008Fixes / 04.
 * Used by the choose-number step and the registration form (both lazy).
 *
 * Easy numbers and wrong lengths are answered on the phone itself; a number
 * that passes is checked with the server 400 ms after typing stops (one
 * document read there), and a check still in flight is cancelled when the
 * student keeps typing. `onStatus` reports 'free' | 'taken' | 'easy' |
 * 'format' | 'checking' | 'unknown' so the parent can enable its button.
 */
export const LIVE_CHECK_DELAY_MS = 400;

export default function AdmissionNumberField({
  session, kind = 'student', value, onChange, onStatus, label, autoFocus = false, disabled = false,
}) {
  const id = useId();
  const [status, setStatus] = useState({ state: 'idle', message: '' });
  const abortRef = useRef(null);

  useEffect(() => {
    abortRef.current?.abort();
    if (!value) { setStatus({ state: 'idle', message: '' }); onStatus?.('format'); return undefined; }
    const problem = numberProblem(value);
    if (problem) {
      // Too short is not an error while still typing.
      setStatus(problem === 'format' && value.length < 4
        ? { state: 'idle', message: '' }
        : { state: problem, message: numberProblemMessage(problem) });
      onStatus?.(problem);
      return undefined;
    }
    setStatus({ state: 'checking', message: 'Checking…' });
    onStatus?.('checking');
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      try {
        const res = await checkNumber(session, value, kind, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setStatus({ state: res.status, message: res.status === 'free' ? 'Available' : res.message });
        onStatus?.(res.status);
      } catch {
        if (controller.signal.aborted) return;
        // Not known now; choosing will still be checked by the server.
        setStatus({ state: 'unknown', message: '' });
        onStatus?.('unknown');
      }
    }, LIVE_CHECK_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
    // onStatus is a callback from the parent; re-checking on its identity is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, session, kind]);

  const bad = ['taken', 'easy', 'format'].includes(status.state);
  return (
    <div className="mb-3">
      <label className="form-label fw-semibold" htmlFor={id}>
        {label ?? (kind === 'staff' ? 'Choose your 4-digit staff number' : 'Choose your 4-digit admission number')}
        {' '}<span className="text-danger">*</span>
      </label>
      <div className="input-group input-group-lg">
        {kind === 'staff' && <span className="input-group-text">S-</span>}
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={4}
          className={`form-control ${status.state === 'free' ? 'is-valid' : bad ? 'is-invalid' : ''}`}
          placeholder="e.g. 4071"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-describedby={`${id}-status`}
        />
      </div>
      <div id={`${id}-status`} className={`form-text ${status.state === 'free' ? 'text-success' : bad ? 'text-danger' : ''}`} aria-live="polite">
        {status.state === 'free' && <i className="bi bi-check-circle-fill me-1" aria-hidden="true" />}
        {bad && <i className="bi bi-x-circle-fill me-1" aria-hidden="true" />}
        {status.message || 'Any 4 digits you will remember. Not a pattern like 1234 or 1111.'}
      </div>
    </div>
  );
}
