import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { m } from 'framer-motion';
import { requestCode, verifyCode, chooseNumber } from '@services/api/studentAdmission';
import { formatNumber } from '@utils/admissionNumber';
import AdmissionNumberField from './AdmissionNumberField';

/**
 * The two first-time steps of admission-number check-in — 008Fixes / 04.
 * Loaded only when a student reaches them (a lazy chunk), so the check-in
 * form every student sees stays small.
 *
 *   CodeStep          "We sent a 6-digit code…": the code by SMS, "Send again"
 *                     after 60 s (each resend is a new code), and "No SMS? Ask
 *                     your teacher for your code" (she can read it, answer 3).
 *   ChooseNumberStep  choose a 4-digit number, checked live; "Don't forget it".
 */

const ending = (phone) => String(phone ?? '').slice(-3);
// 009Fixes / 03: "your number may be wrong" — its own chunk, loaded on tap.
const FixNumberFlow = lazy(() => import('./FixNumberSteps'));

/** Seconds left until `untilMs`, ticking once a second. */
function useCountdown(untilMs) {
  // A tick re-renders once a second; the time itself is read fresh, so the
  // first figure is never a second stale ("61 s" for a 60 s wait).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!untilMs || untilMs <= Date.now()) return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [untilMs]);
  return untilMs ? Math.max(0, Math.ceil((untilMs - Date.now()) / 1000)) : 0;
}

/** Calls after unmount (the student pressed Back) change nothing. */
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}

/**
 * `purpose` 'register' (009Fixes / 01): a code-first registration's code, for
 * a number with no record yet; `onRefused(message)` when that number can't
 * register (already registered, retired). `onWrongNumber` (009Fixes / 03)
 * shows "Didn't get the code? Your number may be wrong."
 */
export function CodeStep({ session, phone, purpose, onVerified, onBack, onRefused, onWrongNumber }) {
  const mounted = useMounted();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [channel, setChannel] = useState(null);
  const [error, setError] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const wait = useCountdown(resendAt);
  const asked = useRef(false);
  // 010Fixes / 03: this number reached its codes for the hour.
  const [capped, setCapped] = useState(false);

  const send = useCallback(async () => {
    setSending(true);
    setError('');
    try {
      const res = purpose ? await requestCode(session, phone, purpose) : await requestCode(session, phone);
      if (!mounted.current) return;
      setChannel(res.deliveryChannel === 'sms' ? 'sms' : 'teacher');
      setResendAt(Date.now() + (res.retryAfterSeconds ?? 60) * 1000);
    } catch (err) {
      if (!mounted.current) return;
      if (onRefused && (err?.code === 'already_registered' || err?.code === 'retired_number')) {
        onRefused(err.message);
        return;
      }
      if (err?.code === 'already_verified') {
        // Confirmed already, with a number: straight on to check in.
        onVerified({ next: 'checkin' });
        return;
      }
      if (err?.code === 'too_many_codes') {
        // 010Fixes / 03: the hourly cap — the teacher can read the code.
        setChannel((c) => c ?? 'sms');
        setResendAt(0);
        setCapped(true);
        setError(err.message || 'Too many codes for this number this hour. Ask your teacher to read you your code.');
      } else if (err?.status === 429) {
        // A code was sent a moment ago: it still works.
        setChannel((c) => c ?? 'sms');
        setResendAt(Date.now() + (err.retryAfter ?? 60) * 1000);
        setError(err.message || 'Please wait a moment before asking for another code.');
      } else {
        setError(err?.message || 'We could not send a code. Please try again.');
      }
    } finally {
      if (mounted.current) setSending(false);
    }
  }, [session, phone, purpose, onVerified, onRefused, mounted]);

  // One code when the step opens (a ref, so a re-render never sends twice).
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    send();
  }, [send]);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = purpose ? await verifyCode(session, phone, code, purpose) : await verifyCode(session, phone, code);
      if (!mounted.current) return;
      onVerified({ ticket: res.ticket ?? null, next: res.next ?? 'checkin', numberKind: res.numberKind ?? 'student' });
    } catch (err) {
      if (!mounted.current) return;
      if (err?.code === 'too_many_tries') setCode('');
      setError(err?.code === 'invalid_code'
        ? 'That code is not right, or it has expired. Check it, or tap Send again.'
        : (err?.message || 'Could not check the code. Please try again.'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" data-testid="code-step">
      <div className="text-center mb-4">
        <h2 className="fw-bold mb-2 h3">Confirm your phone</h2>
        <p className="text-muted mb-0">
          {channel === 'teacher'
            ? <>We couldn&apos;t send an SMS right now. <strong>Ask your teacher for your code.</strong></>
            : purpose === 'register'
              ? <>We sent a 6-digit code by SMS to the number you entered, ending in <strong>{ending(phone)}</strong>.</>
              : <>We sent a 6-digit code by SMS to the phone number you registered with, ending in <strong>{ending(phone)}</strong>.</>}
        </p>
      </div>
      <form onSubmit={submit} noValidate>
        <label className="form-label fw-semibold" htmlFor="ot-code">Code</label>
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
          {busy ? <><span className="spinner-border spinner-border-sm me-2" />Checking…</> : 'Confirm'}
        </button>
        <button type="button" className="btn btn-light w-100 mb-2" onClick={send} disabled={sending || wait > 0 || capped}>
          {sending ? 'Sending…' : capped ? 'Send again later' : wait > 0 ? `Send again in ${wait} s` : 'Send again'}
        </button>
        {/* 010Fixes / 04: where to turn, in plain sight. */}
        <div id="ot-code-help" className="alert alert-info small text-start mb-3" data-testid="code-help">
          <strong>Didn&apos;t get it?</strong> Ask your teacher for your code. Send again sends the same code.
          {onWrongNumber && (
            <div className="mt-2">
              Registered with a number that doesn&apos;t work (switched off, not yours, or made up)? You can change to your
              real number, the one you&apos;ll use from now on.
              <button type="button" className="btn btn-sm btn-outline-primary w-100 mt-2" onClick={onWrongNumber}>
                Use my real number
              </button>
            </div>
          )}
        </div>
        <button type="button" className="btn btn-outline-secondary w-100" onClick={onBack}>
          <i className="bi bi-arrow-left me-2" aria-hidden="true" />
          Use a different phone number
        </button>
      </form>
    </m.div>
  );
}

export function ChooseNumberStep({ session, phone, ticket, kind = 'student', onChosen, onNeedsCode, onBack }) {
  const mounted = useMounted();
  const [number, setNumber] = useState('');
  const [status, setStatus] = useState('format');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const staff = kind === 'staff';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await chooseNumber(session, phone, number, ticket);
      if (!mounted.current) return;
      onChosen({ number: res.number, kind: res.kind, display: res.display ?? formatNumber(res.kind, res.number) });
    } catch (err) {
      if (!mounted.current) return;
      if (err?.code === 'verification_required') { onNeedsCode(); return; }
      if (err?.code === 'already_has_number') { onChosen({ number: null, kind, display: null, already: true }); return; }
      setError(err?.message || 'Could not save your number. Please try again.');
      if (err?.code === 'number_taken') setStatus('taken');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" data-testid="choose-step">
      <div className="text-center mb-4">
        <h2 className="fw-bold mb-2 h3">{staff ? 'Choose your staff number' : 'Choose your admission number'}</h2>
        <p className="text-muted mb-0">
          Choose any 4 digits. <strong>Don&apos;t forget it:</strong> you&apos;ll use it with your phone
          every time you check in{staff ? ' (it starts with S-)' : ''}.
        </p>
      </div>
      <form onSubmit={submit} noValidate>
        <AdmissionNumberField
          session={session}
          kind={kind}
          value={number}
          onChange={(v) => { setNumber(v); setError(''); }}
          onStatus={setStatus}
          autoFocus
        />
        {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
        <button
          type="submit"
          className="btn btn-primary btn-lg w-100 mb-2"
          disabled={busy || !(status === 'free' || status === 'unknown')}
        >
          {busy ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</> : `Use ${number.length === 4 ? formatNumber(kind, number) : 'this number'}`}
        </button>
        <button type="button" className="btn btn-outline-secondary w-100" onClick={onBack}>
          <i className="bi bi-arrow-left me-2" aria-hidden="true" />
          Use a different phone number
        </button>
      </form>
    </m.div>
  );
}

/**
 * The whole first-time flow, so the session page only says "go here"
 * (008Fixes / 04: its logic and words stay in this lazy chunk, off the
 * check-in form every student loads).
 *
 *   code → (no number yet) choose → back to the card with the number named
 *   code → (has a number)  check in with `number` if known (just registered),
 *                          otherwise back to the card to type it
 *
 * `onDone(notice)` returns to the check-in card with `notice` shown;
 * `onCheckin(number)` checks in straight away.
 */
/** 009Fixes / 01: the code before a registration is saved; `onVerified(ticket)`. */
export function RegisterCodeStep({ session, phone, onVerified, onRefused, onBack }) {
  const verified = useCallback(({ ticket }) => onVerified(ticket), [onVerified]);
  return <CodeStep session={session} phone={phone} purpose="register" onVerified={verified} onRefused={onRefused} onBack={onBack} />;
}

/** 009Fixes / 03: fix my number, from the registration screen (by name and class). */
export function FixNumberByName({ session, phone, classes, onFixed, onBack }) {
  return (
    <Suspense fallback={<div className="text-center py-4"><span className="spinner-border spinner-border-sm text-primary" /></div>}>
      <FixNumberFlow session={session} mode="name" newPhone={phone} classes={classes} onFixed={onFixed} onBack={onBack} />
    </Suspense>
  );
}

export default function AdmissionFlow({ session, phone, number = null, onDone, onCheckin, onBack, fixOn = false, classes = [], onFixed }) {
  const [stage, setStage] = useState({ name: 'code', ticket: null, kind: 'student' });

  const verified = useCallback(({ ticket = null, next, numberKind = 'student' }) => {
    if (next === 'chooseNumber') { setStage({ name: 'choose', ticket, kind: numberKind }); return; }
    if (number) { onCheckin(number); return; }
    onDone({ tone: 'info', text: 'Phone confirmed. Now enter your admission number with your phone.' });
  }, [number, onCheckin, onDone]);

  const chosen = ({ display, already }) => onDone({
    tone: 'info',
    text: already
      ? 'You already have a number. Enter it with your phone. Forgot it? Ask your teacher.'
      : `Your number is ${display}. Don't forget it! Now check in with your number and phone.`,
  });

  if (stage.name === 'fix') {
    return (
      <Suspense fallback={<div className="text-center py-4"><span className="spinner-border spinner-border-sm text-primary" /></div>}>
        <FixNumberFlow session={session} mode="number" oldPhone={phone} classes={classes} onFixed={onFixed}
          onBack={() => setStage({ name: 'code', ticket: null, kind: 'student' })} />
      </Suspense>
    );
  }
  if (stage.name === 'choose') {
    return (
      <ChooseNumberStep
        session={session}
        phone={phone}
        ticket={stage.ticket}
        kind={stage.kind}
        onChosen={chosen}
        onNeedsCode={() => setStage({ name: 'code', ticket: null, kind: 'student' })}
        onBack={onBack}
      />
    );
  }
  return (
    <CodeStep key={stage.name} session={session} phone={phone} onVerified={verified} onBack={onBack}
      onWrongNumber={fixOn && onFixed ? () => setStage({ name: 'fix', ticket: null, kind: 'student' }) : undefined} />
  );
}
