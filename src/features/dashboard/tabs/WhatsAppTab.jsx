import { lazy, Suspense } from 'react';
import WhatsAppPanel from '@features/whatsapp/components/WhatsAppPanel';
import TierGate from '@shared/components/TierGate';
import { useFlag } from '@shared/config/FlagsContext';

// 008Fixes / 08: with SMS on, the tab first asks for the SMS setup (lazy).
const MessagesArea = lazy(() => import('@features/sms/components/MessagesArea'));

/**
 * WhatsApp — 007Fixes / 03. Its own lazy chunk; the gate sits inside the tab,
 * so a Bronze teacher downloads only the prompt. Silver, matching
 * api/whatsapp/campaign.js and (008Fixes) api/messages/sms.js.
 */
export default function WhatsAppTab({ preset }) {
  const smsOn = useFlag('sms.enabled');
  // 003Fixes / 09: remounted with a prepared message from Recent actions.
  const panel = <WhatsAppPanel key={preset.version} preset={preset.preset} />;
  return (
    <TierGate
      tier="silver"
      feature={smsOn ? 'Messages' : 'WhatsApp broadcast'}
      description={smsOn ? 'Message parents by SMS, or one person on WhatsApp' : 'Message every student at once, with no per-message cost'}
    >
      {smsOn ? (
        <Suspense fallback={<div className="text-center py-4"><span className="spinner-border spinner-border-sm text-primary" /></div>}>
          <MessagesArea>{() => panel}</MessagesArea>
        </Suspense>
      ) : panel}
    </TierGate>
  );
}
