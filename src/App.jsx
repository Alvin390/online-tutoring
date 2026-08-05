import { BrowserRouter } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { AuthProvider } from '@features/auth/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { FlagsProvider } from '@shared/config/FlagsContext';
import ErrorBoundary from '@components/ui/ErrorBoundary';
import AppRoutes from './routes/AppRoutes';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        {/* Flags sit outside auth: an unauthenticated student page reads them
            too, and the auth gate itself is flag-controlled from Phase 02. */}
        <FlagsProvider>
          <AuthProvider>
            <ToastProvider>
              <AppRoutes />
              <Analytics />
            </ToastProvider>
          </AuthProvider>
        </FlagsProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
