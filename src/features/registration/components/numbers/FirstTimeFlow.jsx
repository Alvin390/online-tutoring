import { useCallback, useEffect, useRef, useState } from 'react';
import { m } from 'framer-motion';
import { assignNumber } from '@services/api/studentAdmission';
import ConfirmPhoneStep from './ConfirmPhoneStep';
import DifferentNumber from './DifferentNumber';
import NumberPopup from './NumberPopup';

/**
 * No admission number yet — 014Fixes / 04 (owner, 2026-11-24): confirm the
 * phone (one short step), the school GIVES the number, the pop-up shows it,
 * then the student is checked in with it. Next time: phone → number → in.
 *
 *   code → next 'assignNumber' → assign → pop-up → onCheckin(display, phone)
 *   code → next 'checkin'      → onHasNumber(phone)  (a number, phone unconfirmed)
 *
 * 014Fixes / 05: with `allowDifferent` (a phone never confirmed), "That phone
 * isn't near me" moves the registration to the phone they have; everything
 * after uses the NEW phone.
 *
 * `onRefresh(phone)`: the page's settings are out of date (the switch
 * changed): the page checks in again and follows the server; `onBack()`:
 * back to the phone.
 */
export default function FirstTimeFlow({
  session, sessionName, phone: startPhone, allowDifferent = false, onCheckin, onHasNumber, onRefresh, onBack,
}) {
  const [phone, setPhone] = useState(startPhone);
  const [stage, setStage] = useState('confirm'); // 'confirm' | 'different'
  const [given, setGiven] = useState(null); // { display, kind }
  const [ticket, setTicket] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState('');
  const [confirmKey, setConfirmKey] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const assign = useCallback(async (forPhone, withTicket) => {
    setAssigning(true);
    setError('');
    try {
      const res = await assignNumber(session, forPhone, withTicket);
      if (!mounted.current) return;
      setGiven({ display: res.display ?? res.number, kind: res.kind ?? 'student' });
    } catch (err) {
      if (!mounted.current) return;
      if (err?.code === 'already_has_number') { onHasNumber(forPhone); return; }
      if (err?.code === 'verification_required') { setTicket(null); setStage('confirm'); setConfirmKey((k) => k + 1); return; }
      if (err?.code === 'refresh_needed') { onRefresh(forPhone); return; }
      setError(err?.message || 'We could not give you a number just now. Please try again.');
    } finally {
      if (mounted.current) setAssigning(false);
    }
  }, [session, onHasNumber, onRefresh]);

  const verified = useCallback(({ ticket: t, next, phone: movedTo }) => {
    const forPhone = movedTo ?? phone;
    if (movedTo) setPhone(movedTo);
    if (next === 'assignNumber' && t) { setTicket(t); assign(forPhone, t); return; }
    onHasNumber(forPhone);
  }, [assign, onHasNumber, phone]);

  if (given) {
    return <NumberPopup kind={given.kind} display={given.display} session={sessionName} onDone={() => onCheckin(given.display, phone)} />;
  }
  if (ticket) {
    return (
      <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card text-center" data-testid="assign-step">
        {error ? (
          <>
            <p className="alert alert-danger small py-2" role="alert">{error}</p>
            <button type="button" className="btn btn-primary btn-lg w-100" onClick={() => assign(phone, ticket)} disabled={assigning}>Try again</button>
          </>
        ) : (
          <p className="mb-0"><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Getting your admission number…</p>
        )}
      </m.div>
    );
  }
  if (stage === 'different') {
    return (
      <DifferentNumber
        session={session}
        sessionName={sessionName}
        oldPhone={phone}
        onMoved={verified}
        onBack={() => setStage('confirm')}
      />
    );
  }
  return (
    <ConfirmPhoneStep
      key={confirmKey}
      session={session}
      phone={phone}
      onVerified={verified}
      onBack={onBack}
      onDifferentNumber={allowDifferent ? () => setStage('different') : undefined}
    />
  );
}
