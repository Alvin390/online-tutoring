import { useState, useEffect, useCallback } from 'react';
import {
  subscribeToStudents,
  deleteStudent as deleteStudentService,
  getZoomLinks,
  updateZoomLink as updateZoomLinkService,
  registerStudent as updateStudentService,
} from '@services/firebase/firestore';
import { useToast } from '@/context/ToastContext';
import logger from '@utils/logger';
import { trackStudentDelete, trackCSVExport } from '@utils/analytics';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const useDashboard = () => {
  const [morningStudents, setMorningStudents] = useState([]);
  const [eveningStudents, setEveningStudents] = useState([]);
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

  // Load zoom links
  useEffect(() => {
    const loadLinks = async () => {
      try {
        const links = await getZoomLinks();
        setZoomLinks(links);
      } catch (error) {
        logger.error('Load zoom links failed', error);
      }
    };
    loadLinks();
  }, []);

  const updateZoomLink = useCallback(async (session, url) => {
    try {
      await updateZoomLinkService(session, url);
      setZoomLinks(prev => ({
        ...prev,
        [session]: url,
        [`${session}LastUpdated`]: new Date(),
      }));
      showSuccess(`${session.charAt(0).toUpperCase() + session.slice(1)} link updated!`);
      return { success: true };
    } catch (error) {
      logger.error('Update zoom link failed', error);
      showError('Failed to update link. Please try again.');
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

      return [
        index + 1,
        student.studentName,
        student.parentPhone,
        student.class,
        student.subjects,
        student.receiptMessage.substring(0, 50) + (student.receiptMessage.length > 50 ? '...' : ''),
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

  return {
    morningStudents,
    eveningStudents,
    zoomLinks,
    loading,
    activeTab,
    setActiveTab,
    updateZoomLink,
    deleteStudent,
    updateStudent,
    exportToPDF,
    totalStudents: morningStudents.length + eveningStudents.length,
  };
};
