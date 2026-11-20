import { lazy, Suspense } from 'react';
import SessionManager from '../components/SessionManager';
import ClassLinkManager from '../components/ClassLinkManager';
import TierGate from '@shared/components/TierGate';
import { useOptionalBilling } from '@features/billing/context/billingContextValue';

// 013Fixes / 10: the school owner's logins card (lazy; never loaded for other logins).
const LoginsCard = lazy(() => import('../components/logins/LoginsCard'));

/**
 * Setup — 007Fixes / 03: the sessions (times, homepage details, classes and
 * subjects) and the class links, things set up once and rarely changed. Its
 * own lazy chunk, so the dashboard's first download no longer carries them.
 */
export default function SetupTab({ sessions, classLinks, onUpdateLink, loading }) {
  const isOwner = useOptionalBilling()?.plan?.isOwner === true;
  return (
    <>
      {isOwner && (
        <Suspense fallback={null}>
          <LoginsCard />
        </Suspense>
      )}

      {/* Sessions (Phase 05; always shown since Phase 13 / 02). The plan's
          `sessions` feature, matching api/sessions/manage.js. */}
      <TierGate
        requires="sessions"
        feature="Sessions"
        description="Edit your class times and run more than one session"
      >
        <SessionManager />
      </TierGate>

      {/* Class Link Management — one slot per session (Phase 13 / 02 D4). */}
      <ClassLinkManager
        sessions={sessions}
        classLinks={classLinks}
        onUpdate={onUpdateLink}
        loading={loading}
      />
    </>
  );
}
