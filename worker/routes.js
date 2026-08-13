import health from '../api/health.js';

import adminSetRole from '../api/admin/setRole.js';
import adminUsers from '../api/admin/users.js';
import authLoginAttempt from '../api/auth/loginAttempt.js';

import billingInitialize from '../api/billing/initialize.js';
import billingManage from '../api/billing/manage.js';
import billingStatus from '../api/billing/status.js';
import billingWebhook from '../api/billing/webhook.js';

import calendarEvents from '../api/calendar/events.js';
import calendarExport from '../api/calendar/export.js';
import calendarFeedToken from '../api/calendar/feedToken.js';
import calendarManage from '../api/calendar/manage.js';

import classLink from '../api/class/link.js';
import classSetLink from '../api/class/setLink.js';

import cronFeesSweep from '../api/cron/feesSweep.js';
import cronMpesaReconcile from '../api/cron/mpesaReconcile.js';
import cronSubscriptionSweep from '../api/cron/subscriptionSweep.js';

import darajaCallback from '../api/daraja/callback/[secret].js';
import darajaCredentials from '../api/daraja/credentials.js';

import feesApproveReceipt from '../api/fees/approveReceipt.js';
import feesConfig from '../api/fees/config.js';
import feesGenerateInvoices from '../api/fees/generateInvoices.js';
import feesPost from '../api/fees/post.js';
import feesSummary from '../api/fees/summary.js';

import paymentsInitiate from '../api/payments/initiate.js';
import paymentsStatus from '../api/payments/status.js';

import sessionsManage from '../api/sessions/manage.js';

import studentApprove from '../api/student/approve.js';
import studentCheckin from '../api/student/checkin.js';
import studentReceipt from '../api/student/receipt.js';
import studentRemove from '../api/student/remove.js';
import studentRequestCode from '../api/student/requestCode.js';
import studentResubmit from '../api/student/resubmit.js';
import studentVerifyCode from '../api/student/verifyCode.js';

import whatsappCampaign from '../api/whatsapp/campaign.js';
import whatsappUpload from '../api/whatsapp/upload.js';

/**
 * The route table — Phase 12 D6.
 *
 * Vercel routed by filesystem convention: `api/fees/post.js` served
 * `/api/fees/post` with no configuration. Cloudflare Workers have a single
 * entry point, so the mapping that used to be implicit is written down here.
 *
 * Static imports rather than dynamic ones, deliberately. The bundler can then
 * see the whole graph and tree-shake it, and a typo in a path is a BUILD
 * failure rather than a 500 the first time somebody hits that endpoint.
 *
 * Hand-rolled rather than pulling in a router. There is one dynamic segment in
 * the entire surface, the codebase has no framework anywhere else, and a
 * dependency here would be larger than the code it replaced.
 */

/** Exact-match routes: pathname -> handler. */
export const STATIC_ROUTES = {
  '/api/health': health,

  '/api/admin/setRole': adminSetRole,
  '/api/admin/users': adminUsers,
  '/api/auth/loginAttempt': authLoginAttempt,

  '/api/billing/initialize': billingInitialize,
  '/api/billing/manage': billingManage,
  '/api/billing/status': billingStatus,
  '/api/billing/webhook': billingWebhook,

  '/api/calendar/events': calendarEvents,
  '/api/calendar/export': calendarExport,
  '/api/calendar/feedToken': calendarFeedToken,
  '/api/calendar/manage': calendarManage,

  '/api/class/link': classLink,
  '/api/class/setLink': classSetLink,

  '/api/cron/feesSweep': cronFeesSweep,
  '/api/cron/mpesaReconcile': cronMpesaReconcile,
  '/api/cron/subscriptionSweep': cronSubscriptionSweep,

  '/api/daraja/credentials': darajaCredentials,

  '/api/fees/approveReceipt': feesApproveReceipt,
  '/api/fees/config': feesConfig,
  '/api/fees/generateInvoices': feesGenerateInvoices,
  '/api/fees/post': feesPost,
  '/api/fees/summary': feesSummary,

  '/api/payments/initiate': paymentsInitiate,
  '/api/payments/status': paymentsStatus,

  '/api/sessions/manage': sessionsManage,

  '/api/student/approve': studentApprove,
  '/api/student/checkin': studentCheckin,
  '/api/student/receipt': studentReceipt,
  '/api/student/remove': studentRemove,
  '/api/student/requestCode': studentRequestCode,
  '/api/student/resubmit': studentResubmit,
  '/api/student/verifyCode': studentVerifyCode,

  '/api/whatsapp/campaign': whatsappCampaign,
  '/api/whatsapp/upload': whatsappUpload,
};

/**
 * The single dynamic route.
 *
 * `api/daraja/callback/[secret].js` — the segment is a 16-byte random token
 * stored with the Daraja credentials, and the handler compares it in constant
 * time. It is defence in depth behind the IP allowlist, because M-Pesa
 * callbacks carry no signature of any kind.
 */
const DYNAMIC_ROUTES = [
  {
    pattern: /^\/api\/daraja\/callback\/([^/]+)\/?$/,
    handler: darajaCallback,
    params: (match) => ({ secret: decodeURIComponent(match[1]) }),
  },
];

/**
 * @param {string} pathname
 * @returns {{handler: Function, params: object}|null}
 */
export function resolveRoute(pathname) {
  // A trailing slash is the same endpoint; Vercel treated it that way and
  // clients (and Safaricom's dashboard) are inconsistent about adding one.
  const normalised = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  const exact = STATIC_ROUTES[normalised];
  if (exact) return { handler: exact, params: {} };

  for (const route of DYNAMIC_ROUTES) {
    const match = route.pattern.exec(pathname);
    if (match) return { handler: route.handler, params: route.params(match) };
  }

  return null;
}

/** Which sweep each cron expression triggers — see worker/index.js. */
export const CRON_HANDLERS = {
  subscriptionSweep: cronSubscriptionSweep,
  feesSweep: cronFeesSweep,
  mpesaReconcile: cronMpesaReconcile,
};
