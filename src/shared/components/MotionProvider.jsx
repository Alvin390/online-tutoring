import { LazyMotion } from 'framer-motion';

/**
 * framer-motion, loaded lazily — Phase 13 / 08 A4.
 *
 * The app animates with `m.*` components inside this provider. The animation
 * engine (`domAnimation`: animate, exit, hover/tap, in-view — everything this
 * app uses; nothing needs `layout` or drag) arrives in its own chunk after
 * first paint, instead of ~30 KB gz of `motion` sitting in every route's
 * initial bundle. Until it loads, elements render in their final state.
 *
 * `strict`: a stray `motion.*` (which would pull the whole engine back into
 * the main chunk) throws in development.
 */
const loadFeatures = () => import('./motionFeatures').then((mod) => mod.default);

export default function MotionProvider({ children }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  );
}
