import { useState } from 'react';
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
 */
export default function RegisterCode({ session, sessionName, phone, onVerified, onRefused, onBack }) {
  const [stage, setStage] = useState('confirm'); // 'confirm' | 'different'

  if (stage === 'different') {
    return (
      <DifferentNumber
        session={session}
        sessionName={sessionName}
        oldPhone={phone}
        sendFor={(newPhone) => requestCode(session, newPhone, 'register')}
        checkFor={(newPhone, code) => verifyCode(session, newPhone, code, 'register')}
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
      onVerified={({ ticket }) => onVerified(ticket, phone)}
      onRefused={onRefused}
      onBack={onBack}
      onDifferentNumber={() => setStage('different')}
    />
  );
}
