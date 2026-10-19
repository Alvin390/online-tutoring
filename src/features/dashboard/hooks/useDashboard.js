import { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react';
import {
  subscribeToStudents,
  subscribeToPendingApprovals,
  getZoomLinks,
  subscribeToClassLink,
  blockStudent as blockStudentService,
  unblockStudent as unblockStudentService,
  approveReceipt as approveReceiptService,
  declineReceipt as declineReceiptService,
} from '@services/firebase/firestore';
import { setClassLink, decideApproval } from '@services/api/teacher';
import { removeStudent, updateStudentRecord } from '@services/api/sessions';
import { approveReceiptWithPayment } from '@services/api/fees';
import { useSessions } from '@features/sessions/hooks/useSessions';
import { FALLBACK_SESSIONS } from '@shared/constants/sessions';
import { useFlag } from '@shared/config/FlagsContext';
import { useToast } from '@/context/ToastContext';
import logger from '@utils/logger';
import { trackStudentDelete, trackCSVExport } from '@utils/analytics';

// jsPDF is NOT imported statically — see exportToPDF. Phase 10 item 8.

export const useDashboard = () => {
  /**
   * Students, keyed by session id — Phase 10.
   *
   * Replaces the two hardcoded `morningStudents` / `eveningStudents` arrays and
   * their two fixed listeners. This is the Phase 05 gap: a teacher could create
   * a third session and register students into it, but those students never
   * appeared on the dashboard, because nothing was listening to their
   * collection.
   *
   * One listener per ACTIVE session, created and torn down as the session list
   * changes. Deactivating a session now removes its listener rather than
   * leaking it — the plan's "Unsubscribe Properly" item.
   */
  const [studentsBySession, setStudentsBySession] = useState({});
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [classLinkDocs, setClassLinkDocs] = useState({});
  const [legacyLinks, setLegacyLinks] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTabState] = useState(() => {
    try { return sessionStorage.getItem('dashboard.activeTab'); } catch { return null; }
  });
  const feesEnabled = useFlag('fees.enabled');
  const { showSuccess, showError } = useToast();

  // Phase 13 / 02 D1: an empty list on the dashboard triggers the server-side
  // bootstrap of the default sessions.
  const { sessions: allSessions, loading: sessionsLoading } = useSessions({ bootstrap: true });

  /**
   * Every session the dashboard knows about — active AND hidden (Phase 13 /
   * 02 D7), because a hidden session can still hold students the teacher needs
   * to see. Until the bootstrap has created the default documents, the two
   * original sessions stand in, exactly as SessionRoutePage falls back for the
   * student side.
   */
  const sessions = useMemo(() => {
    if (allSessions.length > 0) return allSessions;
    return sessionsLoading ? [] : FALLBACK_SESSIONS;
  }, [allSessions, sessionsLoading]);

  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);

  // Joined into a primitive so the effect below depends on the CONTENT of the
  // list rather than the array identity, which changes on every snapshot.
  const sessionKey = sessionIds.join(',');

  const unsubscribers = useRef(new Map());

  /**
   * Payment notifications — Phase 13 / 04 D2. Uses the student listeners the
   * dashboard already holds: a student's `lastPaymentAt` moving forward means
   * money just landed (an M-Pesa callback, or a payment recorded elsewhere).
   * The first snapshot of each session only records the baseline, so opening
   * the dashboard never replays old payments. No extra listeners.
   */
  const lastPaymentSeen = useRef(new Map());
  const notifyPayment = useRef(null);
  notifyPayment.current = (name) => showSuccess(`Payment received for ${name}.`, 'Fees');


  useEffect(() => {
    const ids = sessionKey ? sessionKey.split(',') : [];
    const live = unsubscribers.current;

    // Tear down listeners for sessions that are gone or newly inactive.
    for (const [id, unsubscribe] of live.entries()) {
      if (!ids.includes(id)) {
        unsubscribe();
        live.delete(id);
        setStudentsBySession((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }

    // Open listeners for sessions we are not yet watching.
    for (const id of ids) {
      if (live.has(id)) continue;
      live.set(
        id,
        subscribeToStudents(id, (students) => {
          const seen = lastPaymentSeen.current;
          const baseline = !seen.has(id);
          if (baseline) seen.set(id, new Map());
          const bySession = seen.get(id);
          for (const student of students) {
            const at = student.lastPaymentAt?.toMillis?.() ?? null;
            const before = bySession.get(student.id);
            if (!baseline && at && bySession.has(student.id) && (before == null || at > before)) {
              notifyPayment.current?.(student.studentName ?? 'a student');
            }
            bySession.set(student.id, at);
          }
          setStudentsBySession((prev) => ({ ...prev, [id]: students }));
          setLoading(false);
        })
      );
    }

    if (ids.length === 0 && !sessionsLoading) setLoading(false);
  }, [sessionKey, sessionsLoading]);

  // Unmount: close every listener. Held in a ref rather than state so this
  // cleanup cannot run against a stale copy.
  useEffect(() => {
    const live = unsubscribers.current;
    return () => {
      for (const unsubscribe of live.values()) unsubscribe();
      live.clear();
    };
  }, []);

  /**
   * Tabs (Phase 13 / 02 D7): active sessions in the teacher's order, then any
   * hidden session that still has students.
   */
  const tabs = useMemo(() => {
    const active = sessions.filter((s) => s.active !== false);
    const hiddenWithStudents = sessions.filter(
      (s) => s.active === false && (studentsBySession[s.id]?.length ?? 0) > 0
    );
    return [...active, ...hiddenWithStudents];
  }, [sessions, studentsBySession]);

  // The remembered tab if it still exists, else the first one.
  const currentTab = tabs.some((t) => t.id === activeTab) ? activeTab : (tabs[0]?.id ?? null);

  const setActiveTab = useCallback((id) => {
    // Phase 13 / 08 B2: a transition, so rendering a large class's table
    // never blocks the click that asked for it (the tab responds at once).
    startTransition(() => setActiveTabState(id));
    try { sessionStorage.setItem('dashboard.activeTab', id); } catch { /* storage unavailable */ }
  }, []);

  // Pending approvals — one collection-group listener across all sessions.
  useEffect(() => {
    const unsubscribe = subscribeToPendingApprovals(setPendingApprovals);
    return () => unsubscribe();
  }, []);

  /**
   * Class links — Phase 13 / 02 D3/D4.
   *
   * One live listener per session on `sessions/{slug}/private/classLink`, the
   * single link store, opened and closed with the session list — so a session
   * created a moment ago gets its link slot immediately, and a link saved from
   * another tab appears without a reload.
   */
  useEffect(() => {
    const ids = sessionKey ? sessionKey.split(',') : [];
    const unsubscribers = ids.map((id) =>
      subscribeToClassLink(id, (link) => {
        setClassLinkDocs((prev) => ({ ...prev, [id]: link }));
      })
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [sessionKey]);

  // Legacy links, read once: shown only for a session whose private document
  // does not exist yet (before the bootstrap migrates it). Never written.
  useEffect(() => {
    getZoomLinks()
      .then((links) => setLegacyLinks(links ?? {}))
      .catch((error) => logger.warn('Legacy class links unavailable', { code: error?.code }));
  }, []);

  /** { [slug]: { url, provider, updatedAt } | null } for every known session. */
  const classLinks = useMemo(() => {
    const out = {};
    for (const id of sessionIds) {
      const linkDoc = classLinkDocs[id];
      if (linkDoc?.url) out[id] = linkDoc;
      else if (legacyLinks[id]) {
        out[id] = {
          url: legacyLinks[id],
          provider: legacyLinks[`${id}Provider`] ?? null,
          updatedAt: legacyLinks[`${id}LastUpdated`] ?? null,
          legacy: true,
        };
      } else out[id] = null;
    }
    return out;
  }, [sessionIds, classLinkDocs, legacyLinks]);

  /**
   * Saves a class link through the serverless handler, which re-validates it
   * with the server copy of parseClassLink. The client validates too, for
   * immediate feedback — but that check is advice, not a control. The saved
   * value arrives back through the listener above.
   */
  const updateClassLink = useCallback(async (session, url) => {
    try {
      await setClassLink(session, url);
      const name = sessions.find((s) => s.id === session)?.name ?? session;
      showSuccess(`${name} link updated!`);
      return { success: true };
    } catch (error) {
      logger.error('Update class link failed', error);
      showError(error?.message ?? 'Failed to update link. Please try again.');
      return { success: false };
    }
  }, [sessions, showSuccess, showError]);

  const approveStudents = useCallback(async (session, phones) => {
    try {
      const result = await decideApproval(session, 'approve', phones);
      showSuccess(
        result.approvedCount === 1
          ? 'Student approved — they can join class now.'
          : `${result.approvedCount} students approved.`
      );
      return { success: true };
    } catch (error) {
      logger.error('Approve students failed', error);
      showError(error?.message ?? 'Could not approve. Please try again.');
      return { success: false };
    }
  }, [showSuccess, showError]);

  const rejectStudents = useCallback(async (session, phones, reason) => {
    try {
      const result = await decideApproval(session, 'reject', phones, reason);
      showSuccess(
        result.rejectedCount === 1
          ? 'Rejection sent. The student can correct their details and resubmit.'
          : `${result.rejectedCount} registrations rejected.`
      );
      return { success: true };
    } catch (error) {
      logger.error('Reject students failed', error);
      showError(error?.message ?? 'Could not reject. Please try again.');
      return { success: false };
    }
  }, [showSuccess, showError]);

  /**
   * Deletes through /api/student/remove (Phase 13 / 03 D2), which also deletes
   * the student's private notes — a direct deleteDoc left them behind,
   * orphaned. The fee record is kept, marked deleted.
   */
  const deleteStudent = useCallback(async (session, phoneNumber, studentName) => {
    try {
      await removeStudent(session, phoneNumber);
      trackStudentDelete(session);
      showSuccess(`${studentName} deleted successfully`);
      return { success: true };
    } catch (error) {
      logger.error('Delete student failed', error);
      showError('Failed to delete student. Please try again.');
      return { success: false };
    }
  }, [showSuccess, showError]);

  /**
   * Edits through /api/student/update — Phase 13 / 03 D1.
   *
   * This used to call the open registration create, which the rules refuse for
   * an existing student (every edit failed), and a phone change deleted the
   * record and re-registered it as pending, unblocked, with balance 0. Now only
   * the four editable fields are sent, and a phone change MOVES the record with
   * its notes and fee history. A large move can stop at the server's
   * per-request budget and report `partial`; it is resumed automatically.
   */
  const updateStudent = useCallback(async (session, phoneNumber, studentData, originalPhone) => {
    const changes = {};
    for (const field of ['studentName', 'class', 'subjects', 'receiptMessage']) {
      if (typeof studentData?.[field] === 'string') changes[field] = studentData[field].trim();
    }
    const from = originalPhone ?? phoneNumber;
    const to = String(phoneNumber ?? '').replace(/[\s-]/g, '');

    try {
      let result = await updateStudentRecord(session, from, changes, to);
      for (let attempt = 0; result?.partial && attempt < 5; attempt += 1) {
        result = await updateStudentRecord(session, from, changes, to);
      }
      if (result?.partial) throw new Error('The move is taking longer than usual. Please press Save again to finish it.');
      showSuccess(to !== from ? 'Student updated — notes and fee history moved to the new number.' : 'Student updated successfully');
      return { success: true };
    } catch (error) {
      logger.error('Update student failed', error);
      showError(error?.message ?? 'Failed to update student. Please try again.');
      return { success: false };
    }
  }, [showSuccess, showError]);

  /**
   * PDF export — Phase 10 item 8.
   *
   * jsPDF and jspdf-autotable are loaded ON DEMAND rather than imported at
   * module scope. Statically, jsPDF drags in html2canvas (197 KB) and its
   * canvas/DOM helpers (155 KB) — roughly 350 KB that every teacher downloaded
   * on every dashboard load to support a button most of them press rarely, if
   * ever.
   */
  const exportToPDF = useCallback(async (session) => {
    const students = studentsBySession[session] ?? [];

    if (students.length === 0) {
      showError('No students to export');
      return;
    }

    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);

    // Create new PDF document
    const doc = new jsPDF();

    // Add title
    doc.setFontSize(18);
    doc.setTextColor(102, 126, 234);
    const sessionName = sessions.find((s) => s.id === session)?.name ?? session;
    doc.text(`${sessionName} - Student List`, 14, 22);

    // Add date
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB')}`, 14, 30);

    // Prepare table data
    const tableData = students.map((student, index) => {
      const regDate = student.registeredAt?.toDate?.()
        .toLocaleDateString('en-GB') || 'N/A';

      // Guarded: an unguarded .substring() on a missing receiptMessage threw
      // and broke the entire export, not just that one row.
      const receipt = student.receiptMessage ?? '';

      return [
        index + 1,
        student.studentName ?? '—',
        student.parentPhone ?? '—',
        student.class ?? '—',
        student.subjects ?? '—',
        receipt.substring(0, 50) + (receipt.length > 50 ? '...' : ''),
        regDate
      ];
    });

    // Add table
    autoTable(doc, {
      head: [['#', 'Student Name', 'Parent Phone', 'Class', 'Subjects', 'Payment Receipt', 'Registered']],
      body: tableData,
      startY: 35,
      theme: 'striped',
      headStyles: {
        fillColor: [102, 126, 234],
        textColor: 255,
        fontSize: 10,
        fontStyle: 'bold',
        halign: 'center'
      },
      bodyStyles: {
        fontSize: 9,
        cellPadding: 3
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 35 },
        2: { cellWidth: 30 },
        3: { cellWidth: 15, halign: 'center' },
        4: { cellWidth: 30 },
        5: { cellWidth: 45 },
        6: { cellWidth: 25, halign: 'center' }
      },
      margin: { top: 35 },
      styles: {
        overflow: 'linebreak',
        cellPadding: 2,
        fontSize: 8
      }
    });

    // Add footer
    const pageCount = doc.internal.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(150);
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.text(
        `Page ${i} of ${pageCount} | Total Students: ${students.length}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }

    // Download
    doc.save(`${session}-students-${new Date().toISOString().split('T')[0]}.pdf`);

    trackCSVExport(session, students.length);
    showSuccess('PDF exported successfully');
  }, [studentsBySession, sessions, showSuccess, showError]);

  const blockStudent = useCallback(async (session, phoneNumber, studentName, blockReason) => {
    try {
      await blockStudentService(session, phoneNumber, blockReason);
      showSuccess(`${studentName} has been blocked`);
      return { success: true };
    } catch (error) {
      logger.error('Block student failed', error);
      showError('Failed to block student. Please try again.');
      return { success: false };
    }
  }, [showSuccess, showError]);

  const unblockStudent = useCallback(async (session, phoneNumber, studentName) => {
    try {
      await unblockStudentService(session, phoneNumber);
      showSuccess(`${studentName} has been unblocked`);
      return { success: true };
    } catch (error) {
      logger.error('Unblock student failed', error);
      showError('Failed to unblock student. Please try again.');
      return { success: false };
    }
  }, [showSuccess, showError]);

  /**
   * Approve a payment receipt — Phase 06 D4.
   *
   * With fees enabled this routes through /api/fees/approveReceipt, which can
   * also post a `payment` ledger entry linked to the receipt. `amount` is
   * OPTIONAL: approving access without recording money stays possible, because
   * sometimes a teacher just wants to let someone in, and forcing an amount
   * would make them invent one.
   *
   * With fees disabled it falls back to the original direct write, so nothing
   * changes for a Bronze deployment.
   */
  const approveReceipt = useCallback(async (session, phoneNumber, studentName, options = {}) => {
    try {
      if (feesEnabled) {
        const result = await approveReceiptWithPayment({
          session,
          phone: phoneNumber,
          ...(options.amount ? { amount: options.amount, method: options.method ?? 'mpesa' } : {}),
          ...(options.reference ? { reference: options.reference } : {}),
        });

        if (result.stillBlocked) {
          // The partial-payment rule surfacing in the teacher's own words.
          showSuccess(
            `Receipt approved for ${studentName}, but KES ${Number(result.balance).toLocaleString('en-KE')} is still outstanding, so they remain blocked.`
          );
        } else {
          showSuccess(`Payment receipt approved for ${studentName}`);
        }
        return { success: true, ...result };
      }

      await approveReceiptService(session, phoneNumber);
      showSuccess(`Payment receipt approved for ${studentName}`);
      return { success: true };
    } catch (error) {
      logger.error('Approve receipt failed', error);
      showError(error?.message ?? 'Failed to approve receipt. Please try again.');
      return { success: false };
    }
  }, [feesEnabled, showSuccess, showError]);

  const declineReceipt = useCallback(async (session, phoneNumber, studentName) => {
    try {
      await declineReceiptService(session, phoneNumber);
      showSuccess(`Payment receipt declined for ${studentName}`);
      return { success: true };
    } catch (error) {
      logger.error('Decline receipt failed', error);
      showError('Failed to decline receipt. Please try again.');
      return { success: false };
    }
  }, [showSuccess, showError]);

  return {
    studentsBySession,
    // Every session (active and hidden), in the teacher's order.
    sessions,
    // The sessions that get a tab: active ones, then hidden ones with students.
    tabs,
    pendingApprovals,
    classLinks,
    loading,
    activeTab: currentTab,
    setActiveTab,
    updateClassLink,
    deleteStudent,
    updateStudent,
    exportToPDF,
    blockStudent,
    unblockStudent,
    approveReceipt,
    declineReceipt,
    approveStudents,
    rejectStudents,
    // Summed across every watched session, not just the two original ones.
    totalStudents: Object.values(studentsBySession).reduce((sum, list) => sum + list.length, 0),
  };
};
