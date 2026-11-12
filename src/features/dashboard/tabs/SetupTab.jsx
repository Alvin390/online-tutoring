import SessionManager from '../components/SessionManager';
import ClassLinkManager from '../components/ClassLinkManager';
import TierGate from '@shared/components/TierGate';

/**
 * Setup — 007Fixes / 03: the sessions (times, homepage details, classes and
 * subjects) and the class links, things set up once and rarely changed. Its
 * own lazy chunk, so the dashboard's first download no longer carries them.
 */
export default function SetupTab({ sessions, classLinks, onUpdateLink, loading }) {
  return (
    <>
      {/* Sessions (Phase 05; always shown since Phase 13 / 02). Bronze,
          matching api/sessions/manage.js. */}
      <TierGate
        tier="bronze"
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
