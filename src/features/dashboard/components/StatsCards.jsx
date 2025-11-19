import { motion } from 'framer-motion';

export default function StatsCards({
  morningCount,
  eveningCount,
  totalCount,
  linksConfigured
}) {
  const stats = [
    {
      title: 'Morning Students',
      value: morningCount,
      icon: 'sunrise-fill',
      color: 'primary',
      gradient: 'morning-gradient',
    },
    {
      title: 'Evening Students',
      value: eveningCount,
      icon: 'moon-stars-fill',
      color: 'danger',
      gradient: 'evening-gradient',
    },
    {
      title: 'Total Students',
      value: totalCount,
      icon: 'people-fill',
      color: 'success',
      gradient: 'success-gradient',
    },
    {
      title: 'Zoom Links',
      value: `${linksConfigured}/2`,
      icon: 'link-45deg',
      color: 'warning',
      gradient: null,
    },
  ];

  return (
    <div className="row g-4 mb-4">
      {stats.map((stat, index) => (
        <div key={stat.title} className="col-md-6 col-lg-3">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className={`stat-card ${stat.gradient ? stat.gradient : ''}`}
            style={{
              borderLeft: `4px solid var(--${stat.color}-color)`,
            }}
          >
            <div className="d-flex justify-content-between align-items-start mb-3">
              <div>
                <p className="text-muted mb-1 small">{stat.title}</p>
                <h2 className="stat-value mb-0">{stat.value}</h2>
              </div>
              <div className={`bg-${stat.color} bg-opacity-10 p-3 rounded`}>
                <i className={`bi bi-${stat.icon} text-${stat.color} fs-4`} />
              </div>
            </div>
            <small className="text-success">
              <i className="bi bi-arrow-up me-1" />
              Active registrations
            </small>
          </motion.div>
        </div>
      ))}
    </div>
  );
}
