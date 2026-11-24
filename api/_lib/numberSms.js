import { FieldValue } from './firebaseAdmin.js';
import { sendSms, smsAvailable, recordSmsBalance } from './sms.js';
import { assertAboveReserve } from './smsCampaign.js';
import { smsCost, smsLength, smsPlainValue, smsUnits } from './smsText.js';
import { recordNumber } from './admissionNumber.js';
import { sessionName } from './sessions.js';

/**
 * The admission number by SMS, ONCE — 014Fixes / 01 (owner ruling 6).
 *
 * After a number is GIVEN (student/number assign, or a registration), one
 * SMS tells the student their number and which session it is for. It is the
 * school's own message about check-in, so it is paid like the check-in codes
 * (the owner's HashBack wallet) and never touches the school's SMS units.
 *
 *   - Below the wallet reserve it is skipped: the reserve is there so codes
 *     keep working (the owner is told, as for any refused send). The pop-up
 *     already showed the number, so nothing is lost.
 *   - Once: `numberSmsAt` is claimed in a transaction before sending; a
 *     retry, a second tab or a second request finds it and sends nothing.
 *   - A failure is logged, never thrown, and the claim is given back, so
 *     the record says truthfully that it was not sent.
 *
 * Always run in waitUntil, after the answer.
 */

export function numberSmsMessage({ kind, digits, session }) {
  const what = kind === 'staff' ? `staff number for ${session} class is S-${digits}` : `admission number for ${session} class is ${digits}`;
  return `Your ${what}. Use it with this phone number every time you check in. Keep it safe.`;
}

export async function sendNumberSms({ db, session, phone, log }) {
  try {
    if (!smsAvailable()) return { sent: false, reason: 'unavailable' };
    const ref = db.doc(`sessions/${session}/students/${phone}`);
    const name = smsPlainValue(await sessionName(db, session));

    // The reserve first: a skipped SMS leaves no claim behind.
    const preview = numberSmsMessage({ kind: 'student', digits: '0000', session: name });
    try {
      await assertAboveReserve(db, smsCost(smsUnits(smsLength(preview))), log);
    } catch (err) {
      if (err?.code === 'low_credit' || err?.status === 402) {
        log.warn('Number SMS skipped: wallet at the reserve', { session });
        return { sent: false, reason: 'reserve' };
      }
      throw err;
    }

    const held = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = snap.data();
      const number = recordNumber(data);
      if (!number || data.numberSmsAt) return null;
      tx.update(ref, { numberSmsAt: FieldValue.serverTimestamp() });
      return number;
    });
    if (!held) return { sent: false, reason: 'already' };

    try {
      const sent = await sendSms({ to: phone, message: numberSmsMessage({ kind: held.kind, digits: held.digits, session: name }) });
      await recordSmsBalance(sent.balance, { log });
      log.info('Number SMS sent', { session, kind: held.kind });
      return { sent: true };
    } catch (err) {
      await ref.update({ numberSmsAt: FieldValue.delete() }).catch(() => {});
      log.warn('Number SMS not sent', { session, code: err?.code, status: err?.status });
      return { sent: false, reason: 'failed' };
    }
  } catch (err) {
    log.warn('Number SMS step failed', { session, code: err?.code });
    return { sent: false, reason: 'error' };
  }
}
