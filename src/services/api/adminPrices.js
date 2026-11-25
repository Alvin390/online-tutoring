import { apiPost } from './client';

/** The price of each package — 013Fixes / 26 (POST /api/admin/prices, superadmin only). */
const call = (body) => apiPost('/api/admin/prices', body);

/** { mode, prices, previous, source, fetchedAt, changedAt } */
export const getPrices = () => call({ action: 'get' });
/** The same, asked of Paystack now. */
export const refreshPrices = () => call({ action: 'refresh' });
/** Changes the Paystack plan for every school. `confirmName` is needed in live mode. */
export const changePrice = ({ tier, amountKes, confirmName }) =>
  call({ action: 'change', tier, amountKes, ...(confirmName ? { confirmName } : {}) });
