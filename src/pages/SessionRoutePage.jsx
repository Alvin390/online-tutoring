import { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { getPublicBootstrap } from '@services/api/public';
import SessionPage from '@features/registration/components/SessionPage';
import LoadingFallback from '@components/ui/LoadingFallback';
import logger from '@utils/logger';
import { FALLBACK_SESSIONS } from '@shared/constants/sessions';

/**
 * Slug-resolved session page — Phase 05 Part A.
 *
 * The slug IS the session document ID. Since Phase 13 / 08 A1 it is resolved
 * against the active-session list from /api/public/bootstrap (shared with the
 * homepage, and no Firestore SDK on the page) instead of a client `getDoc`.
 *
 * `/morning` and `/evening` keep working for free, because those documents are
 * already keyed by exactly those IDs. Every registration link and QR code
 * already in circulation continues to resolve. That is the entire reason for
 * slug-keyed documents rather than generated IDs.
 *
 * FALLBACK. If no session document exists — a deployment that has not run
 * `npm run seed:sessions` yet — the two original sessions still render from
 * hardcoded defaults. Without that, deploying this phase before running the
 * seed would take both class pages offline.
 */

/**
 * The two original sessions, from the shared defaults (Phase 13 / 02) — the
 * same name, description and times the server bootstrap writes, so a page
 * rendered from the fallback looks identical to one rendered from the document.
 */
const LEGACY_FALLBACK = Object.fromEntries(FALLBACK_SESSIONS.map((s) => [s.slug, s]));

export default function SessionRoutePage({ slug: slugProp }) {
  const params = useParams();
  const slug = slugProp ?? params.sessionSlug;

  const [state, setState] = useState({ status: 'loading', session: null });

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (!slug) {
        setState({ status: 'missing', session: null });
        return;
      }

      try {
        const data = await getPublicBootstrap();

        if (cancelled) return;

        // Only ACTIVE sessions are listed: a deactivated session is hidden
        // from students, not deleted, and behaves as though it does not exist.
        const sessions = data?.sessions ?? [];
        const match = sessions.find((s) => s.slug === slug);
        if (match) {
          setState({ status: 'found', session: { id: match.slug, ...match } });
          return;
        }

        // Not listed. Fall back for the two original sessions only, and only
        // on a deployment that has no session documents at all yet.
        if (sessions.length === 0 && LEGACY_FALLBACK[slug]) {
          logger.warn('Session document missing; using legacy fallback', { slug });
          setState({ status: 'found', session: { id: slug, ...LEGACY_FALLBACK[slug] } });
          return;
        }

        setState({ status: 'missing', session: null });
      } catch (error) {
        if (cancelled) return;
        logger.error('Session resolve failed', error);

        // On a read failure, still render the two known sessions rather than
        // 404-ing a class that is about to start.
        if (LEGACY_FALLBACK[slug]) {
          setState({ status: 'found', session: { id: slug, ...LEGACY_FALLBACK[slug] } });
        } else {
          setState({ status: 'missing', session: null });
        }
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.status === 'loading') return <LoadingFallback />;
  if (state.status === 'missing') return <Navigate to="/404" replace />;

  const { session } = state;

  return (
    <SessionPage
      session={session.id}
      label={session.name}
      icon={session.icon ?? 'bi-book-fill'}
      gradient={session.gradient ?? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'}
      schedule={session.schedule ?? null}
      description={session.description ?? ''}
      classes={session.classes}
    />
  );
}
