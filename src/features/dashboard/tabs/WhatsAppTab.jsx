import { lazy, Suspense } from 'react';
import TierGate from '@shared/components/TierGate';
import { useFlag } from '@shared/config/FlagsContext';
import { usePlan } from '@features/billing/hooks/usePlan';

// 008Fixes / 08–09: with SMS on, the tab asks for the SMS setup, then shows
// the SMS / WhatsApp-one-person composer (both lazy).
// 008Fixes / 11 (owner, 2026-11-15: remove the old WhatsApp panel): with SMS
// off, the same composer offers WhatsApp to one person only, with a notice.
const MessagesArea = lazy(() => import('@features/sms/components/MessagesArea'));
const SmsComposer = lazy(() => import('@features/sms/components/SmsComposer'));

const spinner = <div className="text-center py-4"><span className="spinner-border spinner-border-sm text-primary" /></div>;

/**
 * Messages — 007Fixes / 03 (its own lazy chunk).
 *
 * 013Fixes / 02: one-to-one WhatsApp is on every plan, so the tab opens for
 * Bronze too. SMS (setup and sending) is the plan's `bulkSms`, matching
 * api/messages/sms.js: without it the composer runs in its WhatsApp-only mode
 * with an upgrade card for SMS, and never loads the SMS setup.
 */
export default function WhatsAppTab({ preset }) {
  const smsOn = useFlag('sms.enabled');
  const plan = usePlan();
  const smsPlan = plan.has('bulkSms');
  return (
    <TierGate requires="whatsappOneToOne" feature="Messages" description="Message one person on WhatsApp">
      <Suspense fallback={spinner}>
        {/* While the school's plan loads (a login with no stand-in), wait rather
            than open the wrong mode and remount. */}
        {plan.pending ? spinner : smsOn && !smsPlan ? (
          <SmsComposer setup={null} smsOff smsOffReason="plan" />
        ) : smsOn ? (
          // 003Fixes / 09: remounted with a prepared message from Recent actions.
          <MessagesArea>{(setup) => <SmsComposer key={preset.version} setup={setup} preset={preset.preset} />}</MessagesArea>
        ) : (
          <SmsComposer setup={null} smsOff />
        )}
      </Suspense>
    </TierGate>
  );
}
