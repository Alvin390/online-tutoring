import { useEffect, useState } from 'react';
import { getPublicBootstrap } from '@services/api/public';

/**
 * Whether this deployment lets students pay by M-Pesa (STK push).
 *
 * Decided on the server (flag + Gold plan + the superadmin's switch + keys +
 * online after the KES 1 test, see api/_lib/mpesaAvailability.js) and delivered with the public bootstrap, so
 * the "Pay now" button is never offered where the payment would be refused.
 * Starts false: until the answer arrives, only the manual receipt route shows.
 */
/**
 * 013Fixes / 30b: { available, demo } — `demo` when the card is on Demo
 * (sandbox: a payment doesn't pay fees), so the panel can say so up front.
 */
export function useMpesaOffer() {
  const [offer, setOffer] = useState({ available: false, demo: false });

  useEffect(() => {
    let cancelled = false;
    getPublicBootstrap()
      .then((data) => {
        if (!cancelled) setOffer({ available: data?.payments?.mpesa === true, demo: data?.payments?.demo === true });
      })
      .catch(() => { if (!cancelled) setOffer({ available: false, demo: false }); });
    return () => { cancelled = true; };
  }, []);

  return offer;
}

export function useMpesaAvailable() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPublicBootstrap()
      .then((data) => { if (!cancelled) setAvailable(data?.payments?.mpesa === true); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  return available;
}
