import { useState, useCallback } from 'react';
import {
  checkStudentExists,
  registerStudent,
  updateLastAccessed,
  getZoomLinks,
  submitNewReceipt,
} from '@services/firebase/firestore';
import { useToast } from '@/context/ToastContext';
import logger from '@utils/logger';
import { trackRegistration, trackZoomRedirect } from '@utils/analytics';

export const useRegistration = (session) => {
  const [loading, setLoading] = useState(false);
  const [studentData, setStudentData] = useState(null);
  const [isReturningStudent, setIsReturningStudent] = useState(false);
  const [currentPhoneNumber, setCurrentPhoneNumber] = useState('');
  const { showError, showSuccess } = useToast();

  const checkStudent = useCallback(async (phoneNumber) => {
    setLoading(true);
    setCurrentPhoneNumber(phoneNumber);
    try {
      const { exists, data } = await checkStudentExists(session, phoneNumber);

      if (exists) {
        setStudentData(data);
        setIsReturningStudent(true);
        // Don't update lastAccessed if blocked, as we want to show blocked screen
        if (!data.blocked) {
          await updateLastAccessed(session, phoneNumber);
        }
      } else {
        setIsReturningStudent(false);
      }

      return { exists, data };
    } catch (error) {
      logger.error('Check student failed', error);
      showError('Unable to check registration. Please try again.');
      throw error;
    } finally {
      setLoading(false);
    }
  }, [session, showError]);

  const register = useCallback(async (phoneNumber, formData) => {
    setLoading(true);
    try {
      await registerStudent(session, phoneNumber, formData);
      trackRegistration(session, phoneNumber);
      showSuccess('Registration successful!');
      return { success: true };
    } catch (error) {
      logger.error('Registration failed', error);

      if (error.code === 'permission-denied') {
        showError('Registration failed. You may already be registered.');
      } else if (error.code === 'unavailable') {
        showError('Connection error. Please check your internet.');
      } else {
        showError('Registration failed. Please try again.');
      }

      return { success: false, error };
    } finally {
      setLoading(false);
    }
  }, [session, showSuccess, showError]);

  const redirectToZoom = useCallback(async () => {
    try {
      const links = await getZoomLinks();
      const zoomLink = links[session];

      if (!zoomLink) {
        showError('Zoom link not configured. Please contact your teacher.');
        return { success: false };
      }

      if (!zoomLink.includes('zoom.us')) {
        showError('Invalid Zoom link. Please contact your teacher.');
        return { success: false };
      }

      trackZoomRedirect(session);

      // Redirect after delay
      setTimeout(() => {
        window.location.href = zoomLink;
      }, 2000);

      return { success: true, zoomLink };
    } catch (error) {
      logger.error('Zoom redirect failed', error);
      showError('Unable to join class. Please contact your teacher.');
      return { success: false };
    }
  }, [session, showError]);

  const submitReceipt = useCallback(async (receiptMessage) => {
    setLoading(true);
    try {
      await submitNewReceipt(session, currentPhoneNumber, receiptMessage);
      showSuccess('Payment receipt submitted successfully! Awaiting teacher approval.');

      // Refresh student data to show pending status
      const { data } = await checkStudentExists(session, currentPhoneNumber);
      setStudentData(data);

      return { success: true };
    } catch (error) {
      logger.error('Submit receipt failed', error);
      showError('Failed to submit receipt. Please try again.');
      return { success: false, error };
    } finally {
      setLoading(false);
    }
  }, [session, currentPhoneNumber, showSuccess, showError]);

  return {
    loading,
    studentData,
    isReturningStudent,
    checkStudent,
    register,
    redirectToZoom,
    submitReceipt,
  };
};
