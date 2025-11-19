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

// ============================================
// STUDENT OPERATIONS
// ============================================

export const checkStudentExists = async (session, phoneNumber) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
    const docSnap = await getDoc(docRef);

    console.log(`✅ checkStudentExists: session=${session}, phone=${phoneNumber}, exists=${docSnap.exists()}`);

    return {
      exists: docSnap.exists(),
      data: docSnap.exists() ? docSnap.data() : null
    };
  } catch (error) {
    console.error('❌ checkStudentExists failed:', error);
    throw error;
  }
};

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
      session: session
    };

    await setDoc(docRef, studentData);
    console.log(`✅ registerStudent success: session=${session}, phone=${phoneNumber}`);

    return { success: true };
  } catch (error) {
    console.error('❌ registerStudent failed:', error);
    throw error;
  }
};

export const updateLastAccessed = async (session, phoneNumber) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
    await setDoc(docRef, { lastAccessed: serverTimestamp() }, { merge: true });
    console.log(`✅ updateLastAccessed success: session=${session}, phone=${phoneNumber}`);
  } catch (error) {
    console.error('❌ updateLastAccessed failed:', error);
  }
};

export const deleteStudent = async (session, phoneNumber) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
    await deleteDoc(docRef);
    console.log(`✅ deleteStudent success: session=${session}, phone=${phoneNumber}`);
    return { success: true };
  } catch (error) {
    console.error('❌ deleteStudent failed:', error);
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
    querySnapshot.forEach((doc) => {
      students.push({
        id: doc.id,
        ...doc.data()
      });
    });

    console.log(`✅ getStudents success: session=${session}, count=${students.length}`);
    return students;
  } catch (error) {
    console.error('❌ getStudents failed:', error);
    throw error;
  }
};

export const subscribeToStudents = (session, callback) => {
  const studentsRef = collection(db, 'sessions', session, 'students');
  const q = query(studentsRef, orderBy('registeredAt', 'desc'));

  return onSnapshot(q, (querySnapshot) => {
    const students = [];
    querySnapshot.forEach((doc) => {
      students.push({
        id: doc.id,
        ...doc.data()
      });
    });
    console.log(`📡 subscribeToStudents update: session=${session}, count=${students.length}`);
    callback(students);
  }, (error) => {
    console.error('❌ subscribeToStudents error:', error);
  });
};

// ============================================
// ZOOM LINK OPERATIONS
// ============================================

export const getZoomLinks = async () => {
  try {
    const docRef = doc(db, 'config', 'zoomLinks');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      console.log('✅ getZoomLinks success:', docSnap.data());
      return docSnap.data();
    }
    console.log('⚠️ getZoomLinks: No zoom links configured');
    return { morning: '', evening: '' };
  } catch (error) {
    console.error('❌ getZoomLinks failed:', error);
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

    console.log(`✅ updateZoomLink success: session=${session}`);
    return { success: true };
  } catch (error) {
    console.error('❌ updateZoomLink failed:', error);
    throw error;
  }
};
