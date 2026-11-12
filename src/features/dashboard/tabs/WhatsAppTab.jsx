import WhatsAppPanel from '@features/whatsapp/components/WhatsAppPanel';
import TierGate from '@shared/components/TierGate';

/**
 * WhatsApp — 007Fixes / 03. Its own lazy chunk; the gate sits inside the tab,
 * so a Bronze teacher downloads only the prompt. Silver, matching
 * api/whatsapp/campaign.js.
 */
export default function WhatsAppTab({ preset }) {
  return (
    <TierGate
      tier="silver"
      feature="WhatsApp broadcast"
      description="Message every student at once, with no per-message cost"
    >
      {/* 003Fixes / 09: remounted with a prepared message from Recent actions. */}
      <WhatsAppPanel key={preset.version} preset={preset.preset} />
    </TierGate>
  );
}
