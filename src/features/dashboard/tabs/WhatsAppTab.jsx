import { lazy, Suspense } from 'react';
import TierGate from '@shared/components/TierGate';
import { useFlag } from '@shared/config/FlagsContext';

// 008Fixes / 08–09: with SMS on, the tab asks for the SMS setup, then shows
// the SMS / WhatsApp-one-person composer (both lazy).
// 008Fixes / 11 (owner, 2026-11-15: remove the old WhatsApp panel): with SMS
// off, the same composer offers WhatsApp to one person only, with a notice.
const MessagesArea = lazy(() => import('@features/sms/components/MessagesArea'));
const SmsComposer = lazy(() => import('@features/sms/components/SmsComposer'));

const spinner = <div className="text-center py-4"><span className="spinner-border spinner-border-sm text-primary" /></div>;

/**
 * Messages — 007Fixes / 03 (its own lazy chunk; the gate sits inside the tab,
 * so a Bronze teacher downloads only the prompt). Silver, matching
 * api/messages/sms.js.
 */
export default function WhatsAppTab({ preset }) {
  const smsOn = useFlag('sms.enabled');
  return (
    <TierGate requires="whatsappOneToOne" feature="Messages" description="Message parents by SMS, or one person on WhatsApp">
      <Suspense fallback={spinner}>
        {smsOn ? (
          // 003Fixes / 09: remounted with a prepared message from Recent actions.
          <MessagesArea>{(setup) => <SmsComposer key={preset.version} setup={setup} preset={preset.preset} />}</MessagesArea>
        ) : (
          <SmsComposer setup={null} smsOff />
        )}
      </Suspense>
    </TierGate>
  );
}
