import { createHandler } from '../_lib/handler.js';
import { retiredError } from './campaign.js';

/**
 * WhatsApp campaign attachments — RETIRED (013Fixes / 06). No plan includes
 * WhatsApp campaigns or their attachments; every request answers 410 Gone.
 * Files uploaded earlier are kept in storage, not deleted.
 */
export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  rawBody: true,
  rateLimit: { bucket: 'whatsapp_upload', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async () => {
    throw retiredError();
  },
});
