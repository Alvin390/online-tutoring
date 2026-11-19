import { apiPost } from './client';

/**
 * WhatsApp campaigns — retired (013Fixes / 06). Only the school's OLD
 * campaigns are read, for the sent-messages history; nothing is created or
 * sent any more (the server answers 410 to everything else).
 */

export const getCampaign = (campaignId) =>
  apiPost('/api/whatsapp/campaign', { action: 'get', campaignId });

export const listCampaigns = () => apiPost('/api/whatsapp/campaign', { action: 'list' });
