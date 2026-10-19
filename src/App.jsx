import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '@/context/ToastContext';
import { FlagsProvider } from '@shared/config/FlagsContext';
import ErrorBoundary from '@components/ui/ErrorBoundary';
import MotionProvider from '@components/MotionProvider';
import AppRoutes from './routes/AppRoutes';

export default function App() {
  return (
    <ErrorBoundary>
      <MotionProvider>
      <BrowserRouter>
        {/* Flags come from /api/public/bootstrap — no Firebase. Auth and
            billing moved into the lazily loaded StaffShell (Phase 13 / 08 A1),
            so public and student pages never load the Firebase SDK. */}
        <FlagsProvider>
          <ToastProvider>
            {/* Vercel Analytics removed in Phase 12 with the move to
                Cloudflare. Cloudflare Web Analytics is enabled from the
                dashboard and injects its own script, so nothing is needed
                here. */}
            <AppRoutes />
          </ToastProvider>
        </FlagsProvider>
      </BrowserRouter>
      </MotionProvider>
    </ErrorBoundary>
  );
}
