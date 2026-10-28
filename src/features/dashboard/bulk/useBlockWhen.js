import { useCallback, useMemo, useState } from 'react';
import { quickPicks, toInputs, fromInputs, whenProblem } from './scheduleTime';

/**
 * "When?" for a block — Now, or Schedule at a Nairobi date and time —
 * 003Fixes / 08. Shared by the single-student and the bulk block forms.
 * Starts on "Now"; Schedule is pre-filled with the first suggestion
 * (half an hour before the session's next class, else tomorrow 18:00).
 */
export function useBlockWhen(schedule) {
  const picks = useMemo(() => quickPicks(schedule), [schedule]);
  const initial = toInputs(picks[0]?.atMs ?? Date.now() + 86_400_000);
  const [when, setWhen] = useState('now');
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);

  const pick = useCallback((ms) => {
    const v = toInputs(ms);
    setDate(v.date);
    setTime(v.time);
  }, []);
  const reset = useCallback(() => {
    setWhen('now');
    pick(picks[0]?.atMs ?? Date.now() + 86_400_000);
  }, [pick, picks]);

  const atMs = fromInputs(date, time);
  return {
    when, setWhen, date, setDate, time, setTime, picks, pick, reset,
    atMs,
    scheduled: when === 'schedule',
    problem: when === 'schedule' ? whenProblem(atMs) : null,
  };
}
