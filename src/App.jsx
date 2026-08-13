import { BrowserRouter } from 'react-router-dom';
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
                {/* Vercel Analytics removed in Phase 12 with the move to
                    Cloudflare. Cloudflare Web Analytics is enabled from the
                    dashboard and injects its own script, so nothing is needed
                    here. */}
                <AppRoutes />
              </ToastProvider>
            </BillingProvider>
          </AuthProvider>
        </FlagsProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
