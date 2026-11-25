import { useEffect, useRef, useState } from 'react';
import { m } from 'framer-motion';
import Modal from '@shared/components/ui/Modal';
import { fixNumberRequest, fixNumberConfirm } from '@services/api/studentAdmission';
import CountrySelector from '../CountrySelector';
import PhoneInput from '../PhoneInput';
import { usePhoneValidation } from '../../hooks/usePhoneValidation';
import { countries } from '@/shared/constants/countries';
import ConfirmPhoneStep from './ConfirmPhoneStep';
import { maskPhone } from './maskPhone';
import Rich from './Rich';
import { DIFFERENT_NUMBER as COPY } from './numberCopy';

/**
 * "That phone isn't near me. Use a different number." — 014Fixes / 05
 * (owner ruling 8, 2026-11-24). The student types the phone they have; a
 * pop-up says, BEFORE anything is sent, that it will be their number from
 * now on (and the old one stops working); the code goes to the NEW phone;
 * once it is confirmed the whole registration moves there (the existing
 * POST /api/student/fixNumber: once per student, never-confirmed records).
 *
 * `onMoved({ phone, ticket, next, numberKind })` with the new phone. A move
 * that stopped half-way (`partial`) is finished with its ticket first.
 *
 * 014Fixes / 06: registration uses the same screen with its own calls —
 * `sendFor(newPhone)`, `checkFor(newPhone, code)` and `confirmText(newMasked)`
 * (nothing to move yet: the code just confirms the phone being registered).
 */
const MAX_RESUMES = 5;

export default function DifferentNumber({
  session, sessionName, oldPhone, onMoved, onBack, sendFor, checkFor, confirmText,
}) {
  const request = (newPhone) => (sendFor ? sendFor(newPhone) : fixNumberRequest(session, newPhone, { oldPhone }));
  const check = (newPhone, code) => (checkFor ? checkFor(newPhone, code) : fixNumberConfirm(session, newPhone, { oldPhone }, { code }));
  const {
    selectedCountry, phoneNumber, isValid, handleCountryChange, handlePhoneChange, getFullPhoneNumber,
  } = usePhoneValidation();
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(null); // the new phone awaiting "Yes, use this number"
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null); // { phone, deliveryChannel, retryAfterSeconds }
  const [finishing, setFinishing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Kenya by default, as on the first screen.
  useEffect(() => {
    const kenya = countries.find((c) => c.code === 'KE');
    if (kenya) handleCountryChange(kenya);
  }, [handleCountryChange]);

  const submit = (e) => {
    e.preventDefault();
    const next = {};
    if (!selectedCountry) next.country = 'Please select a country';
    if (!isValid) next.phone = `Please enter a valid ${selectedCountry?.length}-digit number`;
    setErrors(next);
    setError('');
    if (Object.keys(next).length) return;
    const newPhone = getFullPhoneNumber();
    if (newPhone === oldPhone) { setError(COPY.same); return; }
    setAsking(newPhone);
  };

  const send = async () => {
    const newPhone = asking;
    setSending(true);
    try {
      const res = await request(newPhone);
      if (!mounted.current) return;
      setAsking(null);
      setSent({ phone: newPhone, deliveryChannel: res.deliveryChannel, retryAfterSeconds: res.retryAfterSeconds });
    } catch (err) {
      if (!mounted.current) return;
      setAsking(null);
      setError(err?.message || 'We could not send a code. Please try again.');
    } finally {
      if (mounted.current) setSending(false);
    }
  };

  const moved = async (res) => {
    let result = res;
    if (result.partial) {
      setFinishing(true);
      try {
        for (let i = 0; i < MAX_RESUMES && result.partial; i += 1) {
          result = await fixNumberConfirm(session, sent.phone, {}, { ticket: result.ticket });
        }
      } catch (err) {
        if (!mounted.current) return;
        setFinishing(false);
        setSent(null);
        setError(err?.message || 'Please try again in a minute.');
        return;
      }
      if (!mounted.current) return;
    }
    onMoved({ phone: result.phone ?? sent.phone, ticket: result.ticket ?? null, next: result.next ?? 'checkin', numberKind: result.numberKind ?? 'student' });
  };

  if (finishing) {
    return (
      <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card text-center">
        <p className="mb-0"><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />{COPY.finishing}</p>
      </m.div>
    );
  }

  if (sent) {
    return (
      <ConfirmPhoneStep
        session={session}
        phone={sent.phone}
        sent={sent}
        sendCode={() => request(sent.phone)}
        checkCode={(code) => check(sent.phone, code)}
        onVerified={moved}
        onBack={() => setSent(null)}
      />
    );
  }

  return (
    <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" data-testid="different-number-step">
      <div className="text-center mb-4">
        <h2 className="fw-bold mb-2 h3">{COPY.title}</h2>
        <p className="text-muted mb-0">{COPY.why}</p>
      </div>
      {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
      <form onSubmit={submit} noValidate>
        <CountrySelector value={selectedCountry} onChange={handleCountryChange} error={errors.country} />
        <PhoneInput country={selectedCountry} value={phoneNumber} onChange={handlePhoneChange} isValid={isValid} error={errors.phone} />
        <button type="submit" className="btn btn-primary btn-lg w-100 mb-2">{COPY.send}</button>
      </form>
      <button type="button" className="btn btn-outline-secondary w-100" onClick={onBack}>
        <i className="bi bi-arrow-left me-2" aria-hidden="true" />
        {COPY.back}
      </button>
      {asking && (
        <Modal
          title={COPY.confirmTitle}
          onClose={() => setAsking(null)}
          footer={(
            <>
              <button type="button" className="btn btn-outline-secondary" onClick={() => setAsking(null)} disabled={sending}>{COPY.goBack}</button>
              <button type="button" className="btn btn-primary" onClick={send} disabled={sending}>
                {sending ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />{COPY.sending}</> : COPY.yes}
              </button>
            </>
          )}
        >
          <p className="mb-0">
            <Rich text={confirmText ? confirmText(maskPhone(asking)) : COPY.confirmBody(maskPhone(asking), maskPhone(oldPhone), sessionName)} />
          </p>
        </Modal>
      )}
    </m.div>
  );
}
