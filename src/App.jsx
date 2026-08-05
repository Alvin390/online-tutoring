import { BrowserRouter } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { AuthProvider } from '@features/auth/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { FlagsProvider } from '@shared/config/FlagsContext';
import { BillingProvider } from '@features/billing/context/BillingContext';
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
            {/* Billing sits inside auth (it needs the ID token) and outside the
                routes (the grace countdown renders above every teacher page). */}
            <BillingProvider>
              <ToastProvider>
                <AppRoutes />
                <Analytics />
              </ToastProvider>
            </BillingProvider>
          </AuthProvider>
        </FlagsProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
