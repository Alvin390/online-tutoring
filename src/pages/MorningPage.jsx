import SessionPage from '@features/registration/components/SessionPage';

/**
 * Morning session.
 *
 * Phase 04 collapsed this and EveningPage into one `SessionPage` component.
 * They were 5,204 and 5,207 bytes of the same file, differing in a constant, a
 * gradient and two strings — and the approval flow would have had to be
 * implemented identically in both.
 *
 * Phase 05 replaces these two files with slug-based routing entirely.
 */
export default function MorningPage() {
  return (
    <SessionPage
      session="morning"
      label="Morning Session"
      icon="bi-sunrise-fill"
      badgeClass="morning-badge"
      gradient="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
    />
  );
}
