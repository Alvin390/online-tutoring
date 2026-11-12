import CalendarPanel from '@features/calendar/components/CalendarPanel';
import TierGate from '@shared/components/TierGate';

/**
 * Calendar — 007Fixes / 03. Its own lazy chunk, out of the teacher's way
 * ("that calendar annoys me because it causes me to scroll"). Silver,
 * matching api/calendar/manage.js and feedToken.js.
 */
export default function CalendarTab() {
  return (
    <TierGate
      tier="silver"
      feature="Class calendar"
      description="Plan the term with weekly recurrence and an .ics feed"
    >
      <CalendarPanel />
    </TierGate>
  );
}
