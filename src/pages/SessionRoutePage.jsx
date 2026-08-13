import { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@services/firebase/config';
import SessionPage from '@features/registration/components/SessionPage';
import LoadingFallback from '@components/ui/LoadingFallback';
import logger from '@utils/logger';

/**
 * Slug-resolved session page — Phase 05 Part A.
 *
 * The slug IS the session document ID, so resolution is one `getDoc` rather
 * than a query — no index, no scan, and unknown slugs fail immediately.
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

const LEGACY_FALLBACK = {
  morning: {
    name: 'Morning Session',
    icon: 'bi-sunrise-fill',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    badgeClass: 'morning-badge',
  },
  evening: {
    name: 'Evening Session',
    icon: 'bi-moon-stars-fill',
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    badgeClass: 'evening-badge',
  },
};

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
        const snap = await getDoc(doc(db, 'sessions', slug));

        if (cancelled) return;

        if (snap.exists()) {
          const data = snap.data();

          // A deactivated session is hidden from students, not deleted. It
          // behaves as though it does not exist rather than showing an empty
          // page they cannot act on.
          if (data.active === false) {
            setState({ status: 'missing', session: null });
            return;
          }

          setState({ status: 'found', session: { id: snap.id, ...data } });
          return;
        }

        // No document. Fall back for the two original sessions only.
        if (LEGACY_FALLBACK[slug]) {
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
      badgeClass={session.badgeClass ?? `${session.id}-badge`}
      gradient={session.gradient ?? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'}
    />
  );
}
