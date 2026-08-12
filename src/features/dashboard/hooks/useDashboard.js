import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  subscribeToStudents,
  subscribeToPendingApprovals,
  deleteStudent as deleteStudentService,
  getZoomLinks,
  registerStudent as updateStudentService,
  blockStudent as blockStudentService,
  unblockStudent as unblockStudentService,
  approveReceipt as approveReceiptService,
  declineReceipt as declineReceiptService,
} from '@services/firebase/firestore';
import { setClassLink, decideApproval } from '@services/api/teacher';
import { approveReceiptWithPayment } from '@services/api/fees';
import { useSessions } from '@features/sessions/hooks/useSessions';
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
  const [zoomLinks, setZoomLinks] = useState({ morning: '', evening: '' });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('morning');
  const feesEnabled = useFlag('fees.enabled');
  const { showSuccess, showError } = useToast();

  const { activeSessions, loading: sessionsLoading } = useSessions();

  /**
   * Session ids to watch.
   *
   * Falls back to the two original sessions when the sessions collection is
   * empty — a deployment that has not run `npm run seed:sessions` must still
   * show its students, exactly as SessionRoutePage falls back for the student
   * side.
   */
  const sessionIds = useMemo(() => {
    if (activeSessions.length > 0) return activeSessions.map((s) => s.id);
    return sessionsLoading ? [] : ['morning', 'evening'];
  }, [activeSessions, sessionsLoading]);

  // Joined into a primitive so the effect below depends on the CONTENT of the
  // list rather than the array identity, which changes on every snapshot.
  const sessionKey = sessionIds.join(',');

  const unsubscribers = useRef(new Map());

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
   * Back-compat accessors. The dashboard's tab UI is still session-keyed, and
   * these keep every existing consumer working while the underlying shape is
   * now dynamic.
   */
  const morningStudents = studentsBySession.morning ?? [];
  const eveningStudents = studentsBySession.evening ?? [];

  // Pending approvals — one collection-group listener across all sessions.
  useEffect(() => {
    const unsubscribe = subscribeToPendingApprovals(setPendingApprovals);
    return () => unsubscribe();
  }, []);

  // Load class links
  useEffect(() => {
    const loadLinks = async () => {
      try {
        const links = await getZoomLinks();
        setZoomLinks(links);
      } catch (error) {
        logger.error('Load class links failed', error);
      }
    };
    loadLinks();
  }, []);

  /**
   * Saves a class link through the serverless handler, which re-validates it
   * with the server copy of parseClassLink. The client validates too, for
   * immediate feedback — but that check is advice, not a control.
   */
  const updateZoomLink = useCallback(async (session, url) => {
    try {
      const result = await setClassLink(session, url);
      setZoomLinks(prev => ({
        ...prev,
        [session]: result.url,
        [`${session}Provider`]: result.provider,
        [`${session}LastUpdated`]: new Date(),
      }));
      showSuccess(`${session.charAt(0).toUpperCase() + session.slice(1)} link updated!`);
      return { success: true };
    } catch (error) {
      logger.error('Update class link failed', error);
      showError(error?.message ?? 'Failed to update link. Please try again.');
      return { success: false };
    }
  }, [showSuccess, showError]);

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

  const deleteStudent = useCallback(async (session, phoneNumber, studentName) => {
    try {
      await deleteStudentService(session, phoneNumber);
      trackStudentDelete(session);
      showSuccess(`${studentName} deleted successfully`);
      return { success: true };
    } catch (error) {
      logger.error('Delete student failed', error);
      showError('Failed to delete student. Please try again.');
      return { success: false };
    }
  }, [showSuccess, showError]);

  const updateStudent = useCallback(async (session, phoneNumber, studentData, originalPhone) => {
    try {
      // If phone number changed, we need to delete old and create new
      if (originalPhone && originalPhone !== phoneNumber) {
        await deleteStudentService(session, originalPhone);
      }

      await updateStudentService(session, phoneNumber, studentData);
      showSuccess('Student updated successfully');
      return { success: true };
    } catch (error) {
      logger.error('Update student failed', error);
      showError('Failed to update student. Please try again.');
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
    doc.text(`${session.charAt(0).toUpperCase() + session.slice(1)} Session - Student List`, 14, 22);

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
  }, [studentsBySession, showSuccess, showError]);

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
    // Dynamic, session-keyed — the shape new code should use.
    studentsBySession,
    sessions: activeSessions,
    // Retained so existing consumers keep working.
    morningStudents,
    eveningStudents,
    pendingApprovals,
    zoomLinks,
    loading,
    activeTab,
    setActiveTab,
    updateZoomLink,
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
