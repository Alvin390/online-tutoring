import { useState, useEffect, useRef } from 'react';
import { m } from 'framer-motion';
import { useSecondsLeft } from '../hooks/useRetryWait';

/**
 * "Check again" pacing — 002Fixes / 05. After each tap the button rests 15 s,
 * then 30 s, then 60 s (and 60 s from then on): at most 12 taps in 10 minutes.
 * On 26 Oct three waiting students used their 20 check-ins in under an hour.
 */
export const CHECK_AGAIN_COOLDOWNS = [15, 30, 60];
const restFor = (taps) => CHECK_AGAIN_COOLDOWNS[Math.min(taps, CHECK_AGAIN_COOLDOWNS.length - 1)];

/**
 * The page checks by itself while it is open and visible — but only after a
 * full minute with NO check of any kind, so a tapping student and the page
 * never add up: manual and automatic together stay within 12 in 10 minutes,
 * under the 20-per-10-minutes limit. At most 10 automatic checks.
 */
export const AUTO_CHECK_MS = 60_000;
export const AUTO_CHECK_MAX = 10;

/**
 * Shown to a student whose registration is awaiting the teacher's decision —
 * Phase 04 Part A.
 *
 * Deliberately warm rather than bureaucratic. From the student's side nothing
 * has gone wrong: they registered correctly and are waiting on a human. The
 * screen says what happens next and what to do if it takes too long, because
 * the single worst version of this page is one that leaves someone refreshing
 * with no idea whether they did something wrong.
 *
 * No class link is fetched on this path. The gate is enforced by
 * /api/class/link server-side; this screen is the explanation, not the control.
 */
export default function PendingApprovalScreen({
  session, studentData, onBack, onRefresh, loading, classTime = null, waitSeconds = 0,
}) {
  // Manual "Check again": a growing rest after each tap.
  const [taps, setTaps] = useState(0);
  const [restUntil, setRestUntil] = useState(0);
  const restLeft = useSecondsLeft(restUntil);

  // Automatic checks: a minute after the last check of any kind, only while
  // the page is visible, never during a check or a rate-limit wait, and at
  // most AUTO_CHECK_MAX of them. `autoDone` also counts skipped ticks, so the
  // page stops checking by itself after about ten minutes either way.
  const [autoDone, setAutoDone] = useState(0);
  const [lastManual, setLastManual] = useState(0);
  const latest = useRef({ onRefresh, loading, waitSeconds, taps });
  latest.current = { onRefresh, loading, waitSeconds, taps };

  const checkAgain = () => {
    onRefresh('manual');
    setTaps((t) => t + 1);
    setRestUntil(Date.now() + restFor(taps) * 1000);
    setLastManual(Date.now()); // the automatic clock starts again from this tap
  };

  useEffect(() => {
    if (autoDone >= AUTO_CHECK_MAX) return undefined;
    const id = setTimeout(() => {
      const now = latest.current;
      const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      if (visible && !now.loading && now.waitSeconds <= 0) {
        now.onRefresh('auto');
        // It just checked: the button rests too, so a tap cannot follow at once.
        setRestUntil(Date.now() + restFor(now.taps) * 1000);
      }
      setAutoDone((n) => n + 1);
    }, AUTO_CHECK_MS);
    return () => clearTimeout(id);
  }, [autoDone, lastManual]);

  const autoStopped = autoDone >= AUTO_CHECK_MAX;
  const disabled = loading || restLeft > 0 || waitSeconds > 0;

  return (
    <m.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card"
    >
      <div className="py-4 text-center">
        <m.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring' }}
          className="mb-4"
        >
          <div
            style={{
              width: '5rem',
              height: '5rem',
              background: 'rgba(245, 158, 11, 0.12)',
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.5rem',
              color: '#d97706',
            }}
          >
            <i className="bi bi-hourglass-split" aria-hidden="true" />
          </div>
        </m.div>

        <h3 className="fw-bold mb-2">You&apos;re registered — just waiting on your teacher</h3>
        <p className="text-muted mb-2">
          {studentData?.studentName ? `Thanks, ${studentData.studentName}. ` : ''}
          Your teacher reviews new students before class.
          {classTime ? <> Class starts at <strong>{classTime}</strong>.</> : null}
        </p>
        <p className="text-muted mb-4" data-testid="auto-check-note">
          {autoStopped
            ? 'Automatic checking has stopped — tap Check again to see if you have been approved.'
            : 'You’ll be let in automatically once you’re approved — keep this page open.'}
        </p>

        {studentData && (
          <div className="text-start bg-light p-3 rounded mb-4">
            <div className="row mb-2">
              <div className="col-5 text-muted small">Session:</div>
              <div className="col-7"><strong className="text-capitalize">{session}</strong></div>
            </div>
            <div className="row mb-2">
              <div className="col-5 text-muted small">Class:</div>
              <div className="col-7"><strong>{studentData.class}</strong></div>
            </div>
            <div className="row">
              <div className="col-5 text-muted small">Subjects:</div>
              <div className="col-7"><strong>{studentData.subjects}</strong></div>
            </div>
          </div>
        )}

        <div className="alert alert-light border d-flex gap-2 text-start" role="status">
          <i className="bi bi-info-circle text-muted mt-1" aria-hidden="true" />
          <span className="small text-muted">
            Most teachers approve within a few hours. If your class is starting soon,
            message your teacher directly — they can approve you in one tap.
          </span>
        </div>

        <button
          className="btn btn-primary btn-lg w-100 mb-3"
          onClick={checkAgain}
          disabled={disabled}
        >
          {loading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Checking…
            </>
          ) : (
            <>
              <i className="bi bi-arrow-clockwise me-2" aria-hidden="true" />
              {restLeft > 0 && waitSeconds <= 0 ? `Check again in ${restLeft} s` : 'Check again'}
            </>
          )}
        </button>

        <button className="btn btn-link" onClick={onBack}>
          <i className="bi bi-arrow-left me-1" aria-hidden="true" />
          Use a different number
        </button>
      </div>
    </m.div>
  );
}
