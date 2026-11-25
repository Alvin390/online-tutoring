import { useCallback, useEffect, useRef, useState } from 'react';
import { m } from 'framer-motion';
import { requestCode, verifyCode } from '@services/api/studentAdmission';
import { maskPhone } from './maskPhone';
import Rich from './Rich';
import { CONFIRM_STEP as COPY } from './numberCopy';

/**
 * "Confirm your phone", then "Enter the code" — 014Fixes / 04 (owner,
 * 2026-11-24): first say WHERE the code goes and to keep that phone near,
 * and send only when the student taps Send code (the 008 step sent at once).
 *
 * `purpose` 'register': a code-first registration's code (no record yet);
 * `onRefused(message)` when that phone can't register (already registered,
 * retired). `onDifferentNumber` (phase 05) shows "That phone isn't near me".
 * `onVerified({ ticket, next, numberKind, phone, partial })` after a correct code.
 *
 * 014Fixes / 05: `sendCode()` / `checkCode(code)` replace the usual calls
 * (moving to a different number sends and checks through fixNumber), and
 * `sent` ({ deliveryChannel, retryAfterSeconds }) opens straight on "Enter
 * the code" when the caller has just sent one.
 *
 * The sending and checking rules are 008/010Fixes' CodeStep's, unchanged:
 * Send again after the server's wait, the hourly cap, "ask your teacher"
 * when no SMS could be sent, and a confirmed record goes straight on.
 */

/** Seconds left until `untilMs`, ticking once a second. */
function useCountdown(untilMs) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!untilMs || untilMs <= Date.now()) return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [untilMs]);
  return untilMs ? Math.max(0, Math.ceil((untilMs - Date.now()) / 1000)) : 0;
}

/** Calls after unmount (the student went back) change nothing. */
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}

export default function ConfirmPhoneStep({
  session, phone, purpose, onVerified, onRefused, onBack, onDifferentNumber, sendCode, checkCode, sent = null,
}) {
  const mounted = useMounted();
  const [stage, setStage] = useState(sent ? 'code' : 'ready'); // 'ready' → 'code'
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [channel, setChannel] = useState(sent ? (sent.deliveryChannel === 'sms' ? 'sms' : 'teacher') : null);
  const [error, setError] = useState('');
  const [resendAt, setResendAt] = useState(() => (sent ? Date.now() + (sent.retryAfterSeconds ?? 60) * 1000 : 0));
  const [capped, setCapped] = useState(false);
  const wait = useCountdown(resendAt);
  const masked = maskPhone(phone);

  const send = useCallback(async () => {
    setSending(true);
    setError('');
    try {
      const res = sendCode
        ? await sendCode()
        : purpose ? await requestCode(session, phone, purpose) : await requestCode(session, phone);
      if (!mounted.current) return;
      setChannel(res.deliveryChannel === 'sms' ? 'sms' : 'teacher');
      setResendAt(Date.now() + (res.retryAfterSeconds ?? 60) * 1000);
      setStage('code');
    } catch (err) {
      if (!mounted.current) return;
      if (onRefused && (err?.code === 'already_registered' || err?.code === 'retired_number')) {
        onRefused(err.message);
        return;
      }
      if (err?.code === 'already_verified') {
        // Confirmed already, with a number: straight on to type it.
        onVerified({ ticket: null, next: 'checkin' });
        return;
      }
      if (err?.code === 'too_many_codes') {
        // 010Fixes / 03: the hourly cap — the teacher can read the code.
        setChannel((c) => c ?? 'sms');
        setResendAt(0);
        setCapped(true);
        setStage('code');
        setError(err.message || 'Too many codes for this number this hour. Ask your teacher to read you your code.');
      } else if (err?.status === 429) {
        // A code was sent a moment ago: it still works.
        setChannel((c) => c ?? 'sms');
        setResendAt(Date.now() + (err.retryAfter ?? 60) * 1000);
        setStage('code');
        setError(err.message || 'Please wait a moment before asking for another code.');
      } else {
        setError(err?.message || 'We could not send a code. Please try again.');
      }
    } finally {
      if (mounted.current) setSending(false);
    }
  }, [session, phone, purpose, onVerified, onRefused, mounted, sendCode]);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError(COPY.sixDigits); return; }
    setBusy(true);
    setError('');
    try {
      const res = checkCode
        ? await checkCode(code)
        : purpose ? await verifyCode(session, phone, code, purpose) : await verifyCode(session, phone, code);
      if (!mounted.current) return;
      onVerified({
        ticket: res.ticket ?? null, next: res.next ?? 'checkin', numberKind: res.numberKind ?? 'student',
        ...(res.phone ? { phone: res.phone } : {}), ...(res.partial ? { partial: true } : {}),
      });
    } catch (err) {
      if (!mounted.current) return;
      if (err?.code === 'too_many_tries') setCode('');
      setError(err?.code === 'invalid_code' ? COPY.invalid : (err?.message || 'Could not check the code. Please try again.'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (stage === 'ready') {
    return (
      <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" data-testid="confirm-step">
        <div className="text-center mb-4">
          <h2 className="fw-bold mb-2 h3">{COPY.title}</h2>
          <p className="text-muted mb-0"><Rich text={COPY.why(masked)} /></p>
        </div>
        {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
        <button type="button" className="btn btn-primary btn-lg w-100 mb-2" onClick={send} disabled={sending}>
          {sending ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />{COPY.sending}</> : COPY.send}
        </button>
        {onDifferentNumber && (
          <button type="button" className="btn btn-link w-100 mb-2 text-white fw-semibold" onClick={onDifferentNumber}>{COPY.notNear}</button>
        )}
        <button type="button" className="btn btn-outline-secondary w-100" onClick={onBack}>
          <i className="bi bi-arrow-left me-2" aria-hidden="true" />
          {COPY.back}
        </button>
      </m.div>
    );
  }

  return (
    <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" data-testid="code-step">
      <div className="text-center mb-4">
        <h2 className="fw-bold mb-2 h3">{COPY.codeTitle}</h2>
        <p className="text-muted mb-0"><Rich text={channel === 'teacher' ? COPY.noSms : COPY.codeWhy(masked)} /></p>
      </div>
      <form onSubmit={submit} noValidate>
        <label className="form-label fw-semibold" htmlFor="ot-code">{COPY.codeLabel}</label>
        <input
          id="ot-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          className={`form-control form-control-lg text-center mb-2 ${error ? 'is-invalid' : ''}`}
          style={{ letterSpacing: '0.4em' }}
          placeholder="••••••"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-describedby="ot-code-help"
        />
        {error && <div className="invalid-feedback d-block mb-2" role="alert">{error}</div>}
        <button type="submit" className="btn btn-primary btn-lg w-100 mb-2" disabled={busy || code.length !== 6}>
          {busy ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />{COPY.checking}</> : COPY.confirm}
        </button>
        <button type="button" className="btn btn-light w-100 mb-2" onClick={send} disabled={sending || wait > 0 || capped}>
          {sending ? COPY.sending : capped ? COPY.resendLater : wait > 0 ? COPY.resendIn(wait) : COPY.resend}
        </button>
        <div id="ot-code-help" className="alert alert-info small text-start mb-3" data-testid="code-help">
          <strong>{COPY.didntGet}</strong> {COPY.help}
        </div>
        <button type="button" className="btn btn-outline-secondary w-100" onClick={onBack}>
          <i className="bi bi-arrow-left me-2" aria-hidden="true" />
          {COPY.back}
        </button>
      </form>
    </m.div>
  );
}
