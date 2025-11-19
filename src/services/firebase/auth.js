import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';
import { auth } from './config';

export const signIn = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    console.log('✅ Auth sign in successful:', userCredential.user.email);
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error('❌ Auth sign in failed:', error.code, error.message);
    return {
      success: false,
      error: getAuthErrorMessage(error.code)
    };
  }
};

export const signOut = async () => {
  try {
    await firebaseSignOut(auth);
    console.log('✅ Auth sign out successful');
    return { success: true };
  } catch (error) {
    console.error('❌ Auth sign out failed:', error);
    return { success: false, error: error.message };
  }
};

export const onAuthChange = (callback) => {
  return onAuthStateChanged(auth, callback);
};

const getAuthErrorMessage = (code) => {
  const errors = {
    'auth/invalid-email': 'Invalid email address format.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'Invalid email or password.',
    'auth/wrong-password': 'Invalid email or password.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/too-many-requests': 'Too many failed login attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Please check your connection.',
  };
  return errors[code] || 'Login failed. Please try again.';
};
