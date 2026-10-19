import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { AuthProvider } from '@features/auth/context/AuthContext';
import { BillingProvider } from '@features/billing/context/BillingContext';
import FlagsLiveSync from '@shared/config/FlagsLiveSync';

/**
 * The staff side of the app — Phase 13 / 08 A1.
 *
 * Everything that needs Firebase (Auth, Firestore listeners, the billing
 * context, live flags) lives under this lazily loaded layout route, used only
 * by /login, /dashboard, /billing and /superadmin. The homepage and class
 * pages never load it, so a student's phone never downloads the Firebase SDK
 * (~130 KB gz) — the largest single cost of the old initial bundle.
 */

const GOOGLE_ORIGINS = ['https://firestore.googleapis.com', 'https://identitytoolkit.googleapis.com'];

/** A6: warm the connections staff pages are about to use (never on public pages). */
function usePreconnect() {
  useEffect(() => {
    const links = GOOGLE_ORIGINS
      .filter((href) => !document.head.querySelector(`link[rel="preconnect"][href="${href}"]`))
      .map((href) => {
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = href;
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
        return link;
      });
    return () => links.forEach((link) => link.remove());
  }, []);
}

export default function StaffShell() {
  usePreconnect();
  return (
    <AuthProvider>
      {/* Billing sits inside auth (it needs the ID token) and above the staff
          routes (the grace countdown renders above every teacher page). */}
      <BillingProvider>
        <FlagsLiveSync />
        <Outlet />
      </BillingProvider>
    </AuthProvider>
  );
}
