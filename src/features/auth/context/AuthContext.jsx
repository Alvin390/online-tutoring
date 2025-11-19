import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthChange, signIn as firebaseSignIn, signOut as firebaseSignOut } from '@services/firebase/auth';
import { trackLogin } from '@services/firebase/analytics';
import logger from '@utils/logger';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    logger.info('AuthProvider: Setting up auth state listener');

    const unsubscribe = onAuthChange((firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);

      if (firebaseUser) {
        logger.info('Auth state changed: User logged in', { email: firebaseUser.email });
      } else {
        logger.info('Auth state changed: User logged out');
      }
    });

    return () => {
      logger.debug('AuthProvider: Cleaning up auth listener');
      unsubscribe();
    };
  }, []);

  const signIn = async (email, password) => {
    setError(null);
    logger.info('signIn: Attempting login', { email });

    const result = await firebaseSignIn(email, password);

    if (result.success) {
      logger.info('signIn: Login successful', { email });
      trackLogin(email);
      return { success: true };
    } else {
      logger.warn('signIn: Login failed', { email, error: result.error });
      setError(result.error);
      return { success: false, error: result.error };
    }
  };

  const signOut = async () => {
    logger.info('signOut: Attempting logout');

    const result = await firebaseSignOut();

    if (result.success) {
      setUser(null);
      setError(null);
      logger.info('signOut: Logout successful');
    } else {
      logger.error('signOut: Logout failed', result.error);
    }

    return result;
  };

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
