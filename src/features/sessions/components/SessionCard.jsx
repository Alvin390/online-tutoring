import { Link } from 'react-router-dom';
import { formatSchedule } from '@utils/formatSchedule';
import { DEFAULT_SESSION_ICON, DEFAULT_SESSION_GRADIENT } from '@shared/constants/sessions';
import '@/styles/landing.css';

/**
 * One session's homepage card — Phase 13 / 02 D5/D8.
 *
 * EVERY visible detail comes from the session document: name, time line
 * (formatSchedule), description, icon and colour gradient. Nothing about a
 * session is hard-coded, so a teacher's edit — or a brand-new session — shows
 * here with no code change.
 *
 * Used twice: on the homepage (as a link to /{slug}) and as the live preview in
 * the dashboard's session editor (`preview`, not a link), so the teacher sees
 * exactly what students will see before saving.
 */
export default function SessionCard({ session, preview = false }) {
  const gradient = session.gradient || DEFAULT_SESSION_GRADIENT;
  const icon = session.icon || DEFAULT_SESSION_ICON;
  const time = formatSchedule(session.schedule);
  const description = session.description?.trim();
  const slug = session.slug ?? session.id;

  const body = (
    <div
      className="session-card h-100"
      style={{ '--card-gradient': gradient }}
      data-testid={`session-card-${slug}`}
    >
      <div className="session-icon-wrapper">
        <div className="session-icon" aria-hidden="true">
          <i className={`bi ${icon}`} />
        </div>
      </div>
      <h3 className="session-card-title">{session.name || 'Untitled session'}</h3>
      {time && (
        <p className="session-card-time">
          <i className="bi bi-clock-fill me-2" aria-hidden="true" />
          {time}
        </p>
      )}
      {description && <p className="session-card-description">{description}</p>}
      <div className="session-card-button">
        Register Now
        <i className="bi bi-arrow-right ms-2" aria-hidden="true" />
      </div>
    </div>
  );

  if (preview) return body;

  return (
    <Link to={`/${slug}`} className="text-decoration-none d-block h-100" aria-label={`${session.name} — register`}>
      {body}
    </Link>
  );
}
