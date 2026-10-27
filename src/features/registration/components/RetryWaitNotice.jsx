/**
 * "Try again in 12 minutes (at 20:00)" — 002Fixes / 05. Replaces the old
 * "Please wait a moment" toast, which on 26 Oct meant up to an hour. The time
 * is the student's own clock.
 */
export default function RetryWaitNotice({ secondsLeft, until }) {
  if (!secondsLeft || secondsLeft <= 0) return null;

  const minutes = Math.ceil(secondsLeft / 60);
  const wait = secondsLeft >= 60
    ? `${minutes} minute${minutes === 1 ? '' : 's'}`
    : `${secondsLeft} second${secondsLeft === 1 ? '' : 's'}`;
  const at = secondsLeft >= 60
    ? ` (at ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
    : '';

  return (
    <div className="alert alert-warning d-flex gap-2 align-items-start" role="status" data-testid="retry-wait">
      <i className="bi bi-hourglass-split mt-1" aria-hidden="true" />
      <span>
        You&apos;ve checked a lot in a short time. Please try again in <strong>{wait}</strong>{at}.
      </span>
    </div>
  );
}
