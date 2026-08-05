import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy
} from 'firebase/firestore';
import { db } from './config';
import logger from '@utils/logger';

/**
 * Direct Firestore access.
 *
 * Phase 01 scope change: everything in here now runs as an AUTHENTICATED
 * TEACHER, with one deliberate exception — `registerStudent`, because a student
 * has no identity until they have registered.
 *
 * Student-facing reads and writes moved to `src/services/api/student.js`, which
 * calls serverless handlers. They had to move: student documents are no longer
 * world-readable, and an unauthenticated visitor has no credential a rule could
 * evaluate.
 *
 * No `console.*` calls in this file. Every one of the 27 that used to be here
 * ran in production, and nine of them interpolated the parent's phone number
 * straight into the browser console.
 */

// ============================================
// STUDENT OPERATIONS
// ============================================

/**
 * Teacher-side existence check. The student-side equivalent is
 * `checkinStudent()` in the API service — it cannot read this collection.
 */
export const checkStudentExists = async (session, phoneNumber) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
    const docSnap = await getDoc(docRef);

    logger.debug('checkStudentExists', { session, exists: docSnap.exists() });

    return {
      exists: docSnap.exists(),
      data: docSnap.exists() ? docSnap.data() : null
    };
  } catch (error) {
    logger.error('checkStudentExists failed', error);
    throw error;
  }
};

/**
 * Open registration create. The four state fields below are not decoration —
 * `firestore.rules` rejects a create that omits them or that tries to
 * self-approve. Writing them here keeps the client and the rule in agreement.
 */
export const registerStudent = async (session, phoneNumber, data) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);

    const studentData = {
      studentName: data.studentName,
      parentPhone: phoneNumber,
      class: data.class,
      subjects: data.subjects,
      receiptMessage: data.receiptMessage,
      registeredAt: serverTimestamp(),
      lastAccessed: serverTimestamp(),
      session: session,

      // Mandated initial state — see isValidStudentCreate in firestore.rules.
      blocked: false,
      approvalStatus: 'pending',
      receiptStatus: 'pending',
      feeBalance: 0
    };

    await setDoc(docRef, studentData);
    logger.info('registerStudent success', { session });

    return { success: true };
  } catch (error) {
    logger.error('registerStudent failed', error);
    throw error;
  }
};

export const deleteStudent = async (session, phoneNumber) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
    await deleteDoc(docRef);
    logger.info('deleteStudent success', { session });
    return { success: true };
  } catch (error) {
    logger.error('deleteStudent failed', error);
    throw error;
  }
};

export const blockStudent = async (session, phoneNumber, blockReason = '') => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
    await setDoc(docRef, {
      blocked: true,
      blockReason: blockReason,
      blockedAt: serverTimestamp(),
      receiptStatus: 'expired'
    }, { merge: true });
    logger.info('blockStudent success', { session });
    return { success: true };
  } catch (error) {
    logger.error('blockStudent failed', error);
    throw error;
  }
};

export const unblockStudent = async (session, phoneNumber) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
    await setDoc(docRef, {
      blocked: false,
      blockReason: '',
      blockedAt: null,
      receiptStatus: 'approved',
      pendingReceipt: null
    }, { merge: true });
    logger.info('unblockStudent success', { session });
    return { success: true };
  } catch (error) {
    logger.error('unblockStudent failed', error);
    throw error;
  }
};

export const approveReceipt = async (session, phoneNumber) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('Student not found');
    }

    const data = docSnap.data();
    await setDoc(docRef, {
      blocked: false,
      blockReason: '',
      receiptMessage: data.pendingReceipt || data.receiptMessage,
      pendingReceipt: null,
      receiptStatus: 'approved',
      receiptApprovedAt: serverTimestamp()
    }, { merge: true });
    logger.info('approveReceipt success', { session });
    return { success: true };
  } catch (error) {
    logger.error('approveReceipt failed', error);
    throw error;
  }
};

export const declineReceipt = async (session, phoneNumber) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
    await setDoc(docRef, {
      receiptStatus: 'declined',
      pendingReceipt: null,
      receiptDeclinedAt: serverTimestamp()
    }, { merge: true });
    logger.info('declineReceipt success', { session });
    return { success: true };
  } catch (error) {
    logger.error('declineReceipt failed', error);
    throw error;
  }
};

// ============================================
// DASHBOARD OPERATIONS
// ============================================

export const getStudents = async (session) => {
  try {
    const studentsRef = collection(db, 'sessions', session, 'students');
    const q = query(studentsRef, orderBy('registeredAt', 'desc'));
    const querySnapshot = await getDocs(q);

    const students = [];
    querySnapshot.forEach((studentDoc) => {
      students.push({
        id: studentDoc.id,
        ...studentDoc.data()
      });
    });

    logger.debug('getStudents success', { session, count: students.length });
    return students;
  } catch (error) {
    logger.error('getStudents failed', error);
    throw error;
  }
};

export const subscribeToStudents = (session, callback) => {
  const studentsRef = collection(db, 'sessions', session, 'students');
  const q = query(studentsRef, orderBy('registeredAt', 'desc'));

  return onSnapshot(q, (querySnapshot) => {
    const students = [];
    querySnapshot.forEach((studentDoc) => {
      students.push({
        id: studentDoc.id,
        ...studentDoc.data()
      });
    });
    logger.debug('subscribeToStudents update', { session, count: students.length });
    callback(students);
  }, (error) => {
    logger.error('subscribeToStudents error', error);
  });
};

// ============================================
// CLASS LINK OPERATIONS (teacher side)
// ============================================

/**
 * Teacher-side read of the configured class links. Students no longer read this
 * document — `config/zoomLinks` was world-readable, which made the class link
 * public to the internet. They now call /api/class/link, which checks their
 * state before returning a URL.
 */
export const getZoomLinks = async () => {
  try {
    const docRef = doc(db, 'config', 'zoomLinks');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      logger.debug('getZoomLinks success');
      return docSnap.data();
    }
    logger.warn('getZoomLinks: no class links configured');
    return { morning: '', evening: '' };
  } catch (error) {
    logger.error('getZoomLinks failed', error);
    throw error;
  }
};

export const updateZoomLink = async (session, url) => {
  try {
    const docRef = doc(db, 'config', 'zoomLinks');
    await setDoc(docRef, {
      [session]: url,
      [`${session}LastUpdated`]: serverTimestamp()
    }, { merge: true });

    logger.info('updateZoomLink success', { session });
    return { success: true };
  } catch (error) {
    logger.error('updateZoomLink failed', error);
    throw error;
  }
};
