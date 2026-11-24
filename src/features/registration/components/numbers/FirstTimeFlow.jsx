import { useCallback, useEffect, useRef, useState } from 'react';
import { m } from 'framer-motion';
import { assignNumber } from '@services/api/studentAdmission';
import ConfirmPhoneStep from './ConfirmPhoneStep';
import NumberPopup from './NumberPopup';

/**
 * No admission number yet — 014Fixes / 04 (owner, 2026-11-24): confirm the
 * phone (one short step), the school GIVES the number, the pop-up shows it,
 * then the student is checked in with it. Next time: phone → number → in.
 *
 *   code → next 'assignNumber' → assign → pop-up → onCheckin(display)
 *   code → next 'checkin'      → onHasNumber()   (a number, phone unconfirmed)
 *
 * `onRefresh(message)`: the page's settings are out of date (the switch
 * changed); `onBack()`: back to the phone. `onDifferentNumber` is phase 05's.
 */
export default function FirstTimeFlow({
  session, sessionName, phone, onCheckin, onHasNumber, onRefresh, onBack, onDifferentNumber,
}) {
  const [given, setGiven] = useState(null); // { display, kind }
  const [ticket, setTicket] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState('');
  const [confirmKey, setConfirmKey] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const assign = useCallback(async (withTicket) => {
    setAssigning(true);
    setError('');
    try {
      const res = await assignNumber(session, phone, withTicket);
      if (!mounted.current) return;
      setGiven({ display: res.display ?? res.number, kind: res.kind ?? 'student' });
    } catch (err) {
      if (!mounted.current) return;
      if (err?.code === 'already_has_number') { onHasNumber(); return; }
      if (err?.code === 'verification_required') { setTicket(null); setConfirmKey((k) => k + 1); return; }
      if (err?.code === 'refresh_needed') { onRefresh(err.message); return; }
      setError(err?.message || 'We could not give you a number just now. Please try again.');
    } finally {
      if (mounted.current) setAssigning(false);
    }
  }, [session, phone, onHasNumber, onRefresh]);

  const verified = useCallback(({ ticket: t, next }) => {
    if (next === 'assignNumber' && t) { setTicket(t); assign(t); return; }
    onHasNumber();
  }, [assign, onHasNumber]);

  if (given) {
    return <NumberPopup kind={given.kind} display={given.display} session={sessionName} onDone={() => onCheckin(given.display)} />;
  }
  if (ticket) {
    return (
      <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card text-center" data-testid="assign-step">
        {error ? (
          <>
            <p className="alert alert-danger small py-2" role="alert">{error}</p>
            <button type="button" className="btn btn-primary btn-lg w-100" onClick={() => assign(ticket)} disabled={assigning}>Try again</button>
          </>
        ) : (
          <p className="mb-0"><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Getting your admission number…</p>
        )}
      </m.div>
    );
  }
  return (
    <ConfirmPhoneStep
      key={confirmKey}
      session={session}
      phone={phone}
      onVerified={verified}
      onBack={onBack}
      onDifferentNumber={onDifferentNumber}
    />
  );
}
