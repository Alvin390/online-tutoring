import { motion, useReducedMotion } from 'framer-motion';
import { memo, useMemo } from 'react';

/**
 * Dashboard stat cards — Phase 10 D3/D6.
 *
 * Three changes here:
 *
 * 1. **Session-agnostic.** It took `morningCount` and `eveningCount` as fixed
 *    props, so a teacher-created third session was invisible. It now renders a
 *    card per session from the dynamic map, with a cap so twelve sessions do
 *    not produce twelve cards.
 *
 * 2. **Memoised.** Re-rendered on every dashboard state change, including one
 *    student's `lastAccessed` heartbeat, to display four numbers that had not
 *    moved.
 *
 * 3. **Reduced-motion respected.** The staggered entrance animation is
 *    decorative; with `prefers-reduced-motion` the cards simply appear.
 */

const SESSION_ICONS = {
  morning: 'sunrise-fill',
  evening: 'moon-stars-fill',
};

const SESSION_COLOURS = ['primary', 'danger', 'info', 'secondary'];

function StatsCards({ studentsBySession, sessions, totalCount, linksConfigured }) {
  const reduceMotion = useReducedMotion();

  const stats = useMemo(() => {
    const bySession = studentsBySession ?? {};
    const ids = Object.keys(bySession);

    // Name each session from its document where available, so a renamed
    // session shows its real name rather than its slug.
    const nameFor = (id) =>
      sessions?.find((s) => s.id === id)?.name
      ?? `${id.charAt(0).toUpperCase()}${id.slice(1)} Students`;

    // Two session cards at most, so the row stays four across. Beyond that the
    // total card carries the rest — the per-session detail is in the tabs.
    const sessionCards = ids.slice(0, 2).map((id, index) => ({
      title: nameFor(id),
      value: bySession[id]?.length ?? 0,
      icon: SESSION_ICONS[id] ?? 'people',
      color: SESSION_COLOURS[index % SESSION_COLOURS.length],
      gradient: id === 'morning' ? 'morning-gradient' : id === 'evening' ? 'evening-gradient' : null,
    }));

    return [
      ...sessionCards,
      {
        title: 'Total Students',
        value: totalCount ?? 0,
        icon: 'people-fill',
        color: 'success',
        gradient: 'success-gradient',
        // Honest subtitle when there are more sessions than cards shown.
        note: ids.length > 2 ? `across ${ids.length} sessions` : null,
      },
      {
        title: 'Class Links',
        value: `${linksConfigured}/${Math.max(ids.length, 2)}`,
        icon: 'link-45deg',
        color: 'warning',
        gradient: null,
      },
    ];
  }, [studentsBySession, sessions, totalCount, linksConfigured]);

  return (
    <div className="row g-4 mb-4">
      {stats.map((stat, index) => (
        <div key={stat.title} className="col-md-6 col-lg-3">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduceMotion ? { duration: 0 } : { delay: index * 0.1 }}
            className={`stat-card ${stat.gradient ? stat.gradient : ''}`}
            style={{ borderLeft: `4px solid var(--${stat.color}-color)` }}
          >
            <div className="d-flex justify-content-between align-items-start mb-3">
              <div>
                <p className="text-muted mb-1 small">{stat.title}</p>
                <h2 className="stat-value mb-0">{stat.value}</h2>
              </div>
              <div className={`bg-${stat.color} bg-opacity-10 p-3 rounded`}>
                <i className={`bi bi-${stat.icon} text-${stat.color} fs-4`} aria-hidden="true" />
              </div>
            </div>
            <small className="text-muted">
              {stat.note ?? 'Active registrations'}
            </small>
          </motion.div>
        </div>
      ))}
    </div>
  );
}

export default memo(StatsCards);
