import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useBilling } from '../context/BillingContext';

/**
 * Grace-period countdown — Phase 03 D7. The "red beaming clock" from Q5.
 *
 * Visible on every teacher route while status is `grace` or `past_due`.
 *
 * Design notes that are requirements, not decoration:
 *   - ONE interval, here in the component that owns the banner. Driving a
 *     per-second tick from several consumers would re-render half the tree
 *     every second.
 *   - `prefers-reduced-motion` replaces the pulse with a static red border. The
 *     animation is purely decorative, so removing it costs nothing and pulsing
 *     red is a genuine problem for vestibular and photosensitive users.
 *   - `aria-live` announces HOURS remaining, not seconds. A live region
 *     updating once a second is unusable with a screen reader.
 *   - Dismissible per session, returning on reload — until under 6 hours
 *     remain, at which point it cannot be dismissed at all.
 */

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const DISMISS_KEY = 'grace-banner-dismissed';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);

    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}

export default function GracePeriodCountdown() {
  const { inGrace, graceEndsAt, billingEnabled } = useBilling();
  const reducedMotion = usePrefersReducedMotion();

  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === 'true'
  );

  const active = billingEnabled && inGrace && graceEndsAt != null;

  // The single interval. Only runs while the banner is actually live.
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const remaining = active ? Math.max(0, graceEndsAt - now) : 0;
  const urgent = remaining > 0 && remaining < SIX_HOURS_MS;

  const { hh, mm, ss, hoursLeft } = useMemo(() => {
    const total = Math.floor(remaining / 1000);
    return {
      hh: String(Math.floor(total / 3600)).padStart(2, '0'),
      mm: String(Math.floor((total % 3600) / 60)).padStart(2, '0'),
      ss: String(total % 60).padStart(2, '0'),
      hoursLeft: Math.ceil(total / 3600),
    };
  }, [remaining]);

  if (!active) return null;
  // Under six hours the banner is not dismissible — this is the last warning
  // before access stops.
  if (dismissed && !urgent) return null;

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  };

  return (
    <>
      <style>{`
        @keyframes grace-pulse { 0%,100% { opacity:1 } 50% { opacity:.25 } }
        .grace-colon { animation: grace-pulse ${urgent ? '0.6s' : '1.4s'} ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .grace-colon { animation: none; } }
      `}</style>

      <div
        className="w-100 text-white px-3 py-2 d-flex align-items-center justify-content-center gap-3 flex-wrap"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1040,
          background: urgent ? '#b02a37' : '#dc3545',
          // Reduced-motion substitute for the pulse: a static heavy border.
          border: reducedMotion ? '3px solid #ffe08a' : 'none',
        }}
        role="status"
      >
        <span className="fw-semibold">
          <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
          {urgent ? 'Access stops very soon' : 'Your subscription needs renewing'}
        </span>

        {/* The clock itself is decorative for assistive tech — the coarse
            announcement below carries the meaning. */}
        <span className="fs-5 fw-bold font-monospace" aria-hidden="true">
          {hh}
          <span className={reducedMotion ? '' : 'grace-colon'}>:</span>
          {mm}
          <span className={reducedMotion ? '' : 'grace-colon'}>:</span>
          {ss}
        </span>

        <span className="visually-hidden" aria-live="polite">
          {hoursLeft <= 1
            ? 'Less than one hour of access remaining. Renew now.'
            : `About ${hoursLeft} hours of access remaining.`}
        </span>

        <Link to="/billing" className="btn btn-light btn-sm fw-semibold">
          Renew now
        </Link>

        {!urgent && (
          <button
            type="button"
            className="btn-close btn-close-white"
            onClick={handleDismiss}
            aria-label="Dismiss renewal reminder for this session"
          />
        )}
      </div>
    </>
  );
}
