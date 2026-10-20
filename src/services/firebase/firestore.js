import {
  doc,
  getDoc,
  setDoc,
  collection,
  collectionGroup,
  getDocs,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy
} from 'firebase/firestore';
import { db } from './config';
import logger from '@utils/logger';

/**
 * Direct Firestore access.
 *
 * Phase 01 scope change: everything in here now runs as an AUTHENTICATED
 * TEACHER. (Student registration, the one former exception, goes through
 * /api/student/register since Phase 13 / 08 A1.)
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

// registerStudent (a direct client setDoc) was removed in Phase 13 / 08 A1:
// registration goes through /api/student/register, which validates on the
// server and is why public pages no longer load the Firestore SDK.

// deleteStudent (a direct deleteDoc) was removed in Phase 13 / 03: Firestore
// does not cascade, so it left the student's private notes behind. Deletes go
// through /api/student/remove (removeStudent in src/services/api/sessions.js).

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

/**
 * Live pending-approval queue across ALL sessions — Phase 04.
 *
 * A collection-group query, so one listener covers every session instead of one
 * per session. Requires both halves of the Phase 01 setup: the
 * COLLECTION_GROUP-scoped index in firestore.indexes.json and the
 * `match /{path=**}/students/{phone}` wildcard in firestore.rules. With only
 * one of them, this fails with a permission error that does not mention
 * collection groups.
 */
export const subscribeToPendingApprovals = (callback) => {
  const q = query(
    collectionGroup(db, 'students'),
    where('approvalStatus', '==', 'pending'),
    orderBy('registeredAt', 'desc')
  );

  return onSnapshot(
    q,
    (querySnapshot) => {
      const pending = [];
      querySnapshot.forEach((studentDoc) => {
        pending.push({
          id: studentDoc.id,
          // The parent of the students collection is the session document.
          session: studentDoc.ref.parent.parent?.id ?? 'unknown',
          ...studentDoc.data(),
        });
      });
      logger.debug('subscribeToPendingApprovals update', { count: pending.length });
      callback(pending);
    },
    (error) => {
      logger.error('subscribeToPendingApprovals error', error);
      // Surfaced as an empty queue rather than a crashed dashboard. The most
      // likely cause is a missing index or wildcard rule, both of which are
      // deployment problems rather than user problems.
      callback([]);
    }
  );
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
/**
 * Live view of one session's class link — Phase 13 / 02 D3.
 *
 * `sessions/{slug}/private/classLink` is the ONLY link store; the dashboard
 * reads it directly (teacher-readable in firestore.rules) so a link saved from
 * any tab, or migrated by the bootstrap, appears without a reload.
 *
 * @param {string} slug
 * @param {(link: {url: string, provider: string|null, updatedAt: any}|null) => void} callback
 * @returns {() => void} unsubscribe
 */
export const subscribeToClassLink = (slug, callback) =>
  onSnapshot(
    doc(db, 'sessions', slug, 'private', 'classLink'),
    (snap) => {
      callback(snap.exists() ? { url: snap.data().url ?? '', provider: snap.data().provider ?? null, updatedAt: snap.data().updatedAt ?? null } : null);
    },
    (error) => {
      logger.error('subscribeToClassLink error', error);
      callback(null);
    }
  );

/**
 * Legacy class links (config/zoomLinks). Read ONCE by the dashboard as a
 * display fallback for a session whose private link document does not exist
 * yet — i.e. before the Phase 13 bootstrap has migrated it. Never written.
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

// updateZoomLink (a direct client write to config/zoomLinks) was removed in
// Phase 13 / 02: links have one store, written only by /api/class/setLink.
