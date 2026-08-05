import SessionPage from '@features/registration/components/SessionPage';

/**
 * Evening session. See MorningPage for why these are now three-line wrappers.
 */
export default function EveningPage() {
  return (
    <SessionPage
      session="evening"
      label="Evening Session"
      icon="bi-moon-stars-fill"
      badgeClass="evening-badge"
      gradient="linear-gradient(135deg, #f093fb 0%, #f5576c 100%)"
    />
  );
}
