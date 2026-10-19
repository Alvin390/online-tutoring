import { useEffect, useState } from 'react';
import { getPublicBootstrap } from '@services/api/public';

/**
 * Whether this deployment lets students pay by M-Pesa (STK push).
 *
 * Decided on the server (flag + Gold plan + credentials, see
 * api/_lib/mpesaAvailability.js) and delivered with the public bootstrap, so
 * the "Pay now" button is never offered where the payment would be refused.
 * Starts false: until the answer arrives, only the manual receipt route shows.
 */
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
