import { useRef, useState } from 'react';
import { requestCode, verifyCode } from '@services/api/studentAdmission';
import ConfirmPhoneStep from './ConfirmPhoneStep';
import DifferentNumber from './DifferentNumber';
import { REGISTER_PHONE } from './numberCopy';

/**
 * Registering — 014Fixes / 06 (owner rulings 9 and 10): after the form,
 * "Confirm your phone" for the phone on the form (nothing is saved until the
 * code is right). "That phone isn't near me" lets the student register with
 * the phone they have instead: a pop-up first says it will be their number
 * for checking in from now on, then the code goes there.
 *
 * `onVerified(ticket, phone)` with the phone that was confirmed (the form's,
 * or the one typed here); `onRefused(message)` when that phone can't
 * register (already registered, retired).
 *
 * 014Fixes / 07 (012Fixes / 05): a register code answered "not found", or a
 * code entry refused, may mean admission numbers were switched off while the
 * page was open. `onStale()` re-reads the settings ONCE for this step; when it
 * answers true the page has registered without a code (and leaves this step),
 * otherwise the refusal is shown as usual.
 */
const NEVER = () => new Promise(() => {});

export default function RegisterCode({ session, sessionName, phone, onVerified, onRefused, onBack, onStale }) {
  const [stage, setStage] = useState('confirm'); // 'confirm' | 'different'
  const resynced = useRef(false);

  const stale = async (err, codes) => {
    if (!onStale || resynced.current || !codes.includes(err?.code)) return false;
    resynced.current = true;
    return onStale();
  };
  const send = async (forPhone) => {
    try {
      return await requestCode(session, forPhone, 'register');
    } catch (err) {
      if (await stale(err, ['not_found'])) return NEVER();
      throw err;
    }
  };
  const check = async (forPhone, code) => {
    try {
      return await verifyCode(session, forPhone, code, 'register');
    } catch (err) {
      if (await stale(err, ['invalid_code'])) return NEVER();
      throw err;
    }
  };

  if (stage === 'different') {
    return (
      <DifferentNumber
        session={session}
        sessionName={sessionName}
        oldPhone={phone}
        sendFor={send}
        checkFor={check}
        confirmText={(newMasked) => REGISTER_PHONE.confirmBody(newMasked, sessionName)}
        onMoved={({ ticket, phone: confirmed }) => onVerified(ticket, confirmed)}
        onBack={() => setStage('confirm')}
      />
    );
  }
  return (
    <ConfirmPhoneStep
      session={session}
      phone={phone}
      purpose="register"
      sendCode={() => send(phone)}
      checkCode={(code) => check(phone, code)}
      onVerified={({ ticket }) => onVerified(ticket, phone)}
      onRefused={onRefused}
      onBack={onBack}
      onDifferentNumber={() => setStage('different')}
    />
  );
}
