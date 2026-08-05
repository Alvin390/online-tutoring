import { useState, useEffect, useCallback } from 'react';
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
import { useToast } from '@/context/ToastContext';
import logger from '@utils/logger';
import { trackStudentDelete, trackCSVExport } from '@utils/analytics';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const useDashboard = () => {
  const [morningStudents, setMorningStudents] = useState([]);
  const [eveningStudents, setEveningStudents] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [zoomLinks, setZoomLinks] = useState({ morning: '', evening: '' });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('morning');
  const { showSuccess, showError } = useToast();

  // Subscribe to morning students
  useEffect(() => {
    const unsubscribe = subscribeToStudents('morning', (students) => {
      setMorningStudents(students);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to evening students
  useEffect(() => {
    const unsubscribe = subscribeToStudents('evening', (students) => {
      setEveningStudents(students);
    });
    return () => unsubscribe();
  }, []);

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

  const exportToPDF = useCallback((session) => {
    const students = session === 'morning' ? morningStudents : eveningStudents;

    if (students.length === 0) {
      showError('No students to export');
      return;
    }

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
  }, [morningStudents, eveningStudents, showSuccess, showError]);

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

  const approveReceipt = useCallback(async (session, phoneNumber, studentName) => {
    try {
      await approveReceiptService(session, phoneNumber);
      showSuccess(`Payment receipt approved for ${studentName}`);
      return { success: true };
    } catch (error) {
      logger.error('Approve receipt failed', error);
      showError('Failed to approve receipt. Please try again.');
      return { success: false };
    }
  }, [showSuccess, showError]);

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
    totalStudents: morningStudents.length + eveningStudents.length,
  };
};
