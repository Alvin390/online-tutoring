import { useEffect, useRef, useState } from 'react';
import { m } from 'framer-motion';
import { fixNumberRequest, fixNumberConfirm } from '@services/api/studentAdmission';
import CountrySelector from './CountrySelector';
import PhoneInput from './PhoneInput';
import { usePhoneValidation } from '../hooks/usePhoneValidation';
import { countries } from '@/shared/constants/countries';
import { ChooseNumberStep } from './AdmissionSteps';

/**
 * Fix my number — 009Fixes / 03 (owner, 2026-11-16). Loaded only when a
 * student taps the link (a lazy chunk off the class page).
 *
 * Before admission numbers, phones were never confirmed: some students
 * registered with a fake or mistyped number and can't get the code. Once,
 * for a record never confirmed, they move it to their real number:
 *
 *   mode 'number'  from the code step: the record is the number they typed;
 *                  they enter their REAL number
 *   mode 'name'    from the registration screen (they typed their real number
 *                  and it isn't registered): they give their name and class
 *                  as registered
 * → a code to the real number → their record moves there, confirmed →
 *   choose an admission number (if they have none) → back to check in with
 *   the new number filled in (`onFixed(newPhone, notice)`).
 */

const ending = (phone) => String(phone ?? '').slice(-3);
const KENYA = countries.find((c) => c.code === 'KE');

export default function FixNumberFlow({ session, mode = 'number', oldPhone = '', newPhone: knownNewPhone = '', classes = [], onFixed, onBack }) {
  const [stage, setStage] = useState({ name: 'details' });
  const [newPhone, setNewPhone] = useState(knownNewPhone);
  const [studentName, setStudentName] = useState('');
  const [className, setClassName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    if (resendAt <= Date.now()) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const phone = usePhoneValidation();
  const { handleCountryChange } = phone;
  useEffect(() => { if (KENYA) handleCountryChange(KENYA); }, [handleCountryChange]);

  const who = mode === 'number' ? { oldPhone } : { studentName: studentName.trim(), class: className };

  const send = async (target) => {
    setBusy(true);
    setError('');
    try {
      const res = await fixNumberRequest(session, target, who);
      if (!mounted.current) return;
      setNewPhone(target);
      setResendAt(Date.now() + (res.retryAfterSeconds ?? 60) * 1000);
      setNow(Date.now());
      setStage({ name: 'code', channel: res.deliveryChannel === 'sms' ? 'sms' : 'teacher' });
    } catch (err) {
      if (!mounted.current) return;
      // 010Fixes / 03: the server's words (e.g. "Too many codes … ask your teacher").
      if (err?.status === 429 && err?.retryAfter) setResendAt(Date.now() + err.retryAfter * 1000);
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const submitDetails = (e) => {
    e.preventDefault();
    if (mode === 'number') {
      if (!phone.isValid) { setError('Enter your real phone number.'); return; }
      send(phone.getFullPhoneNumber());
      return;
    }
    if (studentName.trim().split(/\s+/).length < 2) { setError('Enter your full name, as you registered.'); return; }
    if (!className) { setError('Choose your class.'); return; }
    send(knownNewPhone);
  };

  const finish = (res) => {
    if (res.next === 'chooseNumber') {
      setStage({ name: 'choose', ticket: res.ticket, kind: res.numberKind ?? 'student' });
      return;
    }
    onFixed(newPhone, {
      tone: 'info',
      text: `Your phone number is now the one ending in ${ending(newPhone)}. Check in with your admission number and this phone.`,
    });
  };

  const confirm = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code.'); return; }
    setBusy(true);
    setError('');
    try {
      let res = await fixNumberConfirm(session, newPhone, who, { code });
      // A move that stopped half-way finishes with the ticket it returned.
      for (let i = 0; res?.partial && i < 3; i += 1) {
        res = await fixNumberConfirm(session, newPhone, who, { ticket: res.ticket });
      }
      if (!mounted.current) return;
      finish(res);
    } catch (err) {
      if (!mounted.current) return;
      setError(err?.code === 'invalid_code'
        ? 'That code is not right, or it has expired. Check it, or tap Send again.'
        : (err?.message || 'Could not check the code. Please try again.'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (stage.name === 'choose') {
    return (
      <ChooseNumberStep
        session={session}
        phone={newPhone}
        ticket={stage.ticket}
        kind={stage.kind}
        onChosen={({ display, already }) => onFixed(newPhone, {
          tone: 'info',
          text: already
            ? `Your phone number is now the one ending in ${ending(newPhone)}. Check in with your admission number and this phone.`
            : `Your phone number is now the one ending in ${ending(newPhone)}, and your admission number is ${display}. Don't forget it! Now check in with your number and phone.`,
        })}
        onNeedsCode={() => setStage({ name: 'details' })}
        onBack={onBack}
      />
    );
  }

  return (
    <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" data-testid="fix-number">
      <div className="text-center mb-4">
        <h2 className="fw-bold mb-2 h3">{stage.name === 'code' ? 'Confirm your real number' : 'Use your real number'}</h2>
        <p className="text-muted mb-0">
          {stage.name === 'code' && (stage.channel === 'teacher'
            ? <>We couldn&apos;t send an SMS right now. <strong>Ask your teacher for your code.</strong></>
            : <>We sent a 6-digit code by SMS to the number ending in <strong>{ending(newPhone)}</strong>.</>)}
          {stage.name === 'details' && mode === 'number' && (
            <>Your registration uses the number ending in <strong>{ending(oldPhone)}</strong>. Enter your <strong>real</strong> phone number: we&apos;ll send the code there and move your registration to it. You can do this once.</>
          )}
          {stage.name === 'details' && mode === 'name' && (
            <>Registered before with a different number? Enter your name and class as you registered. We&apos;ll move your registration to the number ending in <strong>{ending(knownNewPhone)}</strong>. You can do this once.</>
          )}
        </p>
      </div>

      {stage.name === 'details' && (
        <form onSubmit={submitDetails} noValidate>
          {mode === 'number' ? (
            <>
              <CountrySelector value={phone.selectedCountry} onChange={phone.handleCountryChange} />
              <PhoneInput country={phone.selectedCountry} value={phone.phoneNumber} onChange={phone.handlePhoneChange} isValid={phone.isValid} />
            </>
          ) : (
            <>
              <div className="mb-3">
                <label className="form-label fw-semibold" htmlFor="fix-name">Your full name (as you registered)</label>
                <input id="fix-name" className="form-control form-control-lg" autoComplete="name" value={studentName}
                  onChange={(e) => setStudentName(e.target.value)} maxLength={80} />
              </div>
              <div className="mb-3">
                <label className="form-label fw-semibold" htmlFor="fix-class">Your class</label>
                <select id="fix-class" className="form-select form-select-lg" value={className} onChange={(e) => setClassName(e.target.value)}>
                  <option value="">Choose your class</option>
                  {classes.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </>
          )}
          {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
          <button type="submit" className="btn btn-primary btn-lg w-100 mb-2" disabled={busy}>
            {busy ? <><span className="spinner-border spinner-border-sm me-2" />Sending…</> : 'Send me a code'}
          </button>
          <button type="button" className="btn btn-outline-secondary w-100" onClick={onBack}>
            <i className="bi bi-arrow-left me-2" aria-hidden="true" />Back
          </button>
        </form>
      )}

      {stage.name === 'code' && (
        <form onSubmit={confirm} noValidate>
          <label className="form-label fw-semibold" htmlFor="fix-code">Code</label>
          <input
            id="fix-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className={`form-control form-control-lg text-center mb-2 ${error ? 'is-invalid' : ''}`}
            style={{ letterSpacing: '0.4em' }}
            placeholder="••••••"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          {error && <div className="invalid-feedback d-block mb-2" role="alert">{error}</div>}
          <button type="submit" className="btn btn-primary btn-lg w-100 mb-2" disabled={busy || code.length !== 6}>
            {busy ? <><span className="spinner-border spinner-border-sm me-2" />Checking…</> : 'Confirm'}
          </button>
          <button type="button" className="btn btn-light w-100 mb-2" onClick={() => send(newPhone)} disabled={busy || wait > 0}>
            {wait > 90 ? 'Send again later' : wait > 0 ? `Send again in ${wait} s` : 'Send again'}
          </button>
          <p className="form-text text-center mb-3">No SMS? Ask your teacher for your code.</p>
          <button type="button" className="btn btn-outline-secondary w-100" onClick={() => { setStage({ name: 'details' }); setCode(''); setError(''); }}>
            <i className="bi bi-arrow-left me-2" aria-hidden="true" />Back
          </button>
        </form>
      )}
    </m.div>
  );
}
