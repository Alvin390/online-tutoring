import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';
import { auth } from './config';
import logger from '@utils/logger';

export const signIn = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    logger.info('Auth sign in successful');
    return { success: true, user: userCredential.user };
  } catch (error) {
    // Log the code, never the email — and never the raw error, which echoes
    // the attempted address back into the console.
    logger.warn('Auth sign in failed', { code: error.code });
    return {
      success: false,
      error: getAuthErrorMessage(error.code),
      code: error.code
    };
  }
};

export const signOut = async () => {
  try {
    await firebaseSignOut(auth);
    logger.info('Auth sign out successful');
    return { success: true };
  } catch (error) {
    logger.error('Auth sign out failed', error);
    return { success: false, error: 'Sign out failed. Please try again.' };
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
