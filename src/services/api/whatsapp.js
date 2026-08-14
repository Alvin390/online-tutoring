import { apiPost } from './client';

/**
 * WhatsApp campaign calls — Phase 08.
 *
 * Campaigns are created server-side with the recipient list resolved and frozen
 * at creation, which is what makes the queue resumable across a browser restart.
 */

export const createCampaign = (payload) =>
  apiPost('/api/whatsapp/campaign', { action: 'create', ...payload });

export const getCampaign = (campaignId) =>
  apiPost('/api/whatsapp/campaign', { action: 'get', campaignId });

export const listCampaigns = () => apiPost('/api/whatsapp/campaign', { action: 'list' });

export const markRecipient = (campaignId, phone, status, skipReason) =>
  apiPost('/api/whatsapp/campaign', {
    action: 'markRecipient',
    campaignId,
    phone,
    status,
    ...(skipReason ? { skipReason } : {}),
  });

export const completeCampaign = (campaignId) =>
  apiPost('/api/whatsapp/campaign', { action: 'complete', campaignId });

export const abandonCampaign = (campaignId) =>
  apiPost('/api/whatsapp/campaign', { action: 'abandon', campaignId });

/**
 * Removes a campaign and its recipients entirely. Irreversible, and the
 * messages already sent stay sent — only the record goes. Audited server-side
 * with the counts before the delete, so who-was-messaged survives.
 */
export const deleteCampaign = (campaignId) =>
  apiPost('/api/whatsapp/campaign', { action: 'delete', campaignId });

/**
 * Uploads an attachment.
 *
 * Sent as base64 through the handler rather than direct-to-Storage, because a
 * direct upload cannot be magic-byte sniffed or EXIF-stripped — the bytes would
 * land in the bucket before anything looked at them.
 */
export const uploadAttachment = async (file, campaignId) => {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });

  return apiPost('/api/whatsapp/upload', {
    filename: file.name,
    contentType: file.type,
    data,
    ...(campaignId ? { campaignId } : {}),
  });
};
