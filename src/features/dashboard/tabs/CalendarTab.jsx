import CalendarPanel from '@features/calendar/components/CalendarPanel';
import TierGate from '@shared/components/TierGate';

/**
 * Calendar — 007Fixes / 03. Its own lazy chunk, out of the teacher's way
 * ("that calendar annoys me because it causes me to scroll"). Every plan
 * (013Fixes / 02), matching api/calendar/manage.js and feedToken.js; the
 * global `calendar.enabled` switch is what hides it.
 */
export default function CalendarTab() {
  return (
    <TierGate
      requires="calendar"
      feature="Class calendar"
      description="Plan the term with weekly recurrence and an .ics feed"
    >
      <CalendarPanel />
    </TierGate>
  );
}
