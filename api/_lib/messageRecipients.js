import { effectiveApprovalStatus } from './studentState.js';

/**
 * Who a message reaches — shared by WhatsApp campaigns (Phase 08) and SMS
 * (008Fixes / 07), so both apply exactly the same rules: opted-out students
 * are never on the list, only approved registrations, staff only in the
 * 'staff' audience (007Fixes / 08). Moved here unchanged from
 * api/whatsapp/campaign.js.
 */

/**
 * Resolves a filter into a frozen recipient list.
 *
 * Opted-out students are excluded HERE, at resolution, not at send time.
 * Kenya's Data Protection Act 2019 makes opt-out a legal requirement rather
 * than a courtesy, and a list that contains them and relies on the UI to skip
 * them is one bug away from a breach.
 */
export async function resolveRecipients(db, filter, onlySkippedFrom) {
  const sessionsSnap = await db.collection('sessions').get();
  const sessionIds = sessionsSnap.empty
    ? ['morning', 'evening']
    : sessionsSnap.docs.map((d) => d.id);

  const sessionNames = new Map(
    sessionsSnap.docs.map((d) => [d.id, d.data().name ?? d.id])
  );

  // Re-run against only those skipped last time — the common real workflow.
  let allowedPhones = null;
  if (onlySkippedFrom) {
    const previous = await db
      .doc(`whatsapp/campaigns/items/${onlySkippedFrom}`)
      .collection('recipients')
      .where('status', 'in', ['skipped', 'failed', 'queued'])
      .get();
    allowedPhones = new Set(previous.docs.map((d) => d.id));
  }

  const recipients = [];

  const staffOnly = filter.type === 'staff';
  for (const sessionId of sessionIds) {
    if (filter.type === 'session' && !(filter.values ?? []).includes(sessionId)) continue;
    if (staffOnly && (filter.values ?? []).length && !filter.values.includes(sessionId)) continue;

    // eslint-disable-next-line no-await-in-loop
    const studentsSnap = await db.collection(`sessions/${sessionId}/students`).get();

    for (const studentDoc of studentsSnap.docs) {
      const student = studentDoc.data();
      const phone = studentDoc.id;

      if (student.whatsappOptOut === true) continue;
      // 007Fixes / 08: every student audience leaves staff out; 'staff' is staff only.
      if ((student.staff === true) !== staffOnly) continue;
      if (effectiveApprovalStatus(student) !== 'approved') continue;
      if (allowedPhones && !allowedPhones.has(phone)) continue;

      if (filter.type === 'class' && !(filter.values ?? []).includes(student.class)) continue;
      if (filter.type === 'individual'
        && !(filter.values ?? []).includes(phone)
        && !(filter.values ?? []).includes(`${sessionId}:${phone}`)) continue;
      if (filter.onlyOverdue === true && student.overdue !== true) continue;

      recipients.push({
        phone,
        studentName: student.studentName ?? null,
        class: student.class ?? null,
        session: sessionId,
        sessionName: sessionNames.get(sessionId) ?? sessionId,
        feeBalance: typeof student.feeBalance === 'number' ? student.feeBalance : 0,
        nextDueDate: student.nextDueDate ?? null,
      });
    }
  }

  return recipients;
}
