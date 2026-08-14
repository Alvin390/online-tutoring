import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import SendQueue from './SendQueue';
import Modal from '@components/ui/Modal';
import { useAuthState } from '@features/auth/context/AuthContext';
import { useFlag } from '@shared/config/FlagsContext';
import { useToast } from '@/context/ToastContext';
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  markRecipient,
  completeCampaign,
  abandonCampaign,
  deleteCampaign,
  uploadAttachment,
} from '@services/api/whatsapp';
import { VARIABLES, previewWithExamples, formatBytes } from '@utils/messageTemplate';
import { MAX_MESSAGE_LENGTH } from '@utils/waLink';
import logger from '@utils/logger';

/**
 * WhatsApp broadcast — Phase 08 D2/D3/D6.
 *
 * Silver sends to all students. Gold adds filters and attachments — and the
 * filter UI is SHOWN BUT DISABLED for Silver with an upgrade prompt naming
 * Gold, rather than hidden. Feature discoverability drives the upsell; hiding
 * the capability entirely means a Silver teacher never learns it exists.
 */

const DRAFT_KEY = 'wa-campaign-draft';

export default function WhatsAppPanel() {
  const { tierRank, isSuperadmin } = useAuthState();
  const advanced = useFlag('whatsapp.advanced');
  const { showError, showSuccess } = useToast();

  const isGold = isSuperadmin || (tierRank ?? 0) >= 3;
  const canFilter = isGold && advanced;

  const [view, setView] = useState('compose');
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterValues, setFilterValues] = useState([]);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [campaign, setCampaign] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Autosave the draft — losing a carefully worded broadcast to an accidental
  // navigation is the fastest way to stop someone using the feature.
  useEffect(() => {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    if (saved) {
      try {
        const draft = JSON.parse(saved);
        setTitle(draft.title ?? '');
        setTemplate(draft.template ?? '');
      } catch {
        sessionStorage.removeItem(DRAFT_KEY);
      }
    }
  }, []);

  useEffect(() => {
    if (title || template) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title, template }));
    }
  }, [title, template]);

  const loadHistory = useCallback(async () => {
    try {
      const result = await listCampaigns();
      setHistory(result.campaigns ?? []);
    } catch (error) {
      logger.error('Campaign history load failed', error);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const refreshCampaign = useCallback(async (campaignId) => {
    const result = await getCampaign(campaignId);
    setCampaign(result.campaign);
    setRecipients(result.recipients ?? []);
  }, []);

  const handleStart = async () => {
    if (!title.trim() || !template.trim()) {
      showError('Give the campaign a title and a message.');
      return;
    }

    setBusy(true);
    try {
      const result = await createCampaign({
        title: title.trim(),
        messageTemplate: template.trim(),
        filter: canFilter
          ? { type: filterType, values: filterValues, onlyOverdue }
          : { type: 'all' },
        attachments,
      });

      await refreshCampaign(result.campaignId);
      setView('queue');
      sessionStorage.removeItem(DRAFT_KEY);
    } catch (error) {
      logger.error('Campaign create failed', error);
      showError(error?.message ?? 'Could not start the campaign.');
    } finally {
      setBusy(false);
    }
  };

  const handleMark = async (phone, status, skipReason) => {
    setBusy(true);
    try {
      await markRecipient(campaign.id, phone, status, skipReason);
      await refreshCampaign(campaign.id);
    } catch (error) {
      // A per-recipient failure must never halt the queue.
      logger.error('Mark recipient failed', error);
      showError('Could not record that. Move on and it will be retried.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const result = await uploadAttachment(file);
      setAttachments((prev) => [...prev, result]);
      showSuccess('File attached. Its link will be added to the message.');
    } catch (error) {
      logger.error('Attachment upload failed', error);
      showError(error?.message ?? 'Could not upload that file.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const preview = useMemo(() => previewWithExamples(template), [template]);
  const overLimit = template.length > MAX_MESSAGE_LENGTH;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card mb-4">
      <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h5 className="mb-0">
          <i className="bi bi-whatsapp me-2" aria-hidden="true" />
          WhatsApp broadcast
        </h5>
        <div className="btn-group btn-group-sm">
          <button
            className={`btn ${view === 'compose' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setView('compose')}
          >
            Compose
          </button>
          {campaign && (
            <button
              className={`btn ${view === 'queue' ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setView('queue')}
            >
              Queue
            </button>
          )}
          <button
            className={`btn ${view === 'history' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => { setView('history'); loadHistory(); }}
          >
            History
          </button>
        </div>
      </div>

      <div className="card-body">
        {view === 'compose' && (
          <>
            <div className="mb-3">
              <label className="form-label small fw-semibold" htmlFor="wa-title">
                Campaign name <span className="text-muted fw-normal">(only you see this)</span>
              </label>
              <input
                id="wa-title"
                className="form-control"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. March fee reminder"
                maxLength={140}
              />
            </div>

            <div className="mb-2">
              <label className="form-label small fw-semibold" htmlFor="wa-message">Message</label>
              <textarea
                id="wa-message"
                className={`form-control ${overLimit ? 'is-invalid' : ''}`}
                rows={5}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                placeholder="Dear parent, the balance for {{studentName}} is {{balance}}, due {{dueDate}}."
              />
              <div className="d-flex justify-content-between">
                <small className={overLimit ? 'text-danger' : 'text-muted'}>
                  {template.length} / {MAX_MESSAGE_LENGTH}
                </small>
              </div>
            </div>

            <div className="mb-3">
              <span className="small text-muted d-block mb-1">Insert:</span>
              <div className="d-flex flex-wrap gap-1">
                {VARIABLES.map((variable) => (
                  <button
                    key={variable.token}
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => setTemplate((t) => `${t}{{${variable.token}}}`)}
                    title={`${variable.label} — e.g. ${variable.example}`}
                  >
                    {variable.label}
                  </button>
                ))}
              </div>
            </div>

            {template && (
              <div className="mb-3">
                <span className="small fw-semibold d-block mb-1">Preview</span>
                <div className="bg-light rounded p-2 small" style={{ whiteSpace: 'pre-wrap' }}>
                  {preview}
                </div>
              </div>
            )}

            {/* Attachments — Gold. Shown disabled for Silver rather than hidden. */}
            <div className="mb-3">
              <span className="small fw-semibold d-block mb-1">
                Attachments
                {!canFilter && <span className="badge text-bg-warning ms-2">Gold</span>}
              </span>

              {canFilter ? (
                <>
                  <input
                    type="file"
                    className="form-control form-control-sm"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={handleUpload}
                    disabled={uploading || attachments.length >= 5}
                  />
                  <div className="form-text">
                    WhatsApp cannot pre-attach files to a message, so we upload the file
                    and put a download link in the text instead. PDF, JPEG, PNG or WebP,
                    up to 10&nbsp;MB.
                  </div>
                  {attachments.map((attachment) => (
                    <div key={attachment.storagePath} className="d-flex align-items-center gap-2 mt-1">
                      <i className="bi bi-paperclip" aria-hidden="true" />
                      <span className="small">
                        {attachment.filename} ({formatBytes(attachment.sizeBytes)})
                      </span>
                      <button
                        className="btn btn-link btn-sm text-danger p-0"
                        onClick={() =>
                          setAttachments((prev) =>
                            prev.filter((a) => a.storagePath !== attachment.storagePath)
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </>
              ) : (
                <p className="small text-muted mb-0">
                  Sending documents and photos is available on Gold.
                </p>
              )}
            </div>

            {/* Filters — Gold. Present and disabled on Silver, so the capability
                is discoverable rather than invisible. */}
            <div className="mb-3">
              <span className="small fw-semibold d-block mb-1">
                Send to
                {!canFilter && <span className="badge text-bg-warning ms-2">Gold</span>}
              </span>

              <select
                className="form-select form-select-sm"
                value={filterType}
                onChange={(e) => { setFilterType(e.target.value); setFilterValues([]); }}
                disabled={!canFilter}
              >
                <option value="all">All students</option>
                <option value="session">A particular session</option>
                <option value="class">A particular class</option>
                <option value="individual">Chosen students</option>
              </select>

              {!canFilter && (
                <div className="form-text">
                  Silver sends to all students. Upgrade to Gold to message one class or
                  a handful of individuals.
                </div>
              )}

              {canFilter && (
                <div className="form-check mt-2">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="wa-overdue"
                    checked={onlyOverdue}
                    onChange={(e) => setOnlyOverdue(e.target.checked)}
                  />
                  <label className="form-check-label small" htmlFor="wa-overdue">
                    Only students with overdue fees
                  </label>
                </div>
              )}
            </div>

            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={busy || overLimit || !title.trim() || !template.trim()}
            >
              {busy ? <span className="spinner-border spinner-border-sm me-2" /> : null}
              Review recipients &amp; start
            </button>
          </>
        )}

        {view === 'queue' && campaign && (
          <SendQueue
            campaign={campaign}
            recipients={recipients}
            busy={busy}
            onMark={handleMark}
            onComplete={async () => {
              await completeCampaign(campaign.id);
              setCampaign(null);
              setRecipients([]);
              setView('history');
              loadHistory();
            }}
            onAbandon={async () => {
              await abandonCampaign(campaign.id);
              setView('history');
              loadHistory();
            }}
          />
        )}

        {view === 'history' && (
          <div>
            {history.length === 0 ? (
              <p className="text-muted text-center py-3 mb-0">No campaigns yet.</p>
            ) : (
              <ul className="list-group list-group-flush">
                {history.map((item) => (
                  <li key={item.id} className="list-group-item px-0">
                    <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                      <div>
                        <div className="fw-semibold">{item.title}</div>
                        <div className="small text-muted">
                          {item.sentCount ?? 0} sent · {item.skippedCount ?? 0} skipped ·{' '}
                          {item.recipientCount} recipients
                        </div>
                      </div>
                      <div className="text-end">
                        <span
                          className={`badge text-bg-${
                            item.status === 'completed' ? 'success' : item.status === 'in_progress' ? 'warning' : 'secondary'
                          }`}
                        >
                          {item.status.replace('_', ' ')}
                        </span>
                        <div className="d-flex gap-2 justify-content-end">
                          {item.status === 'in_progress' && (
                            <button
                              className="btn btn-link btn-sm p-0"
                              onClick={async () => {
                                await refreshCampaign(item.id);
                                setView('queue');
                              }}
                            >
                              Resume
                            </button>
                          )}
                          <button
                            className="btn btn-link btn-sm p-0 text-danger"
                            onClick={() => setDeleteTarget(item)}
                            aria-label={`Delete campaign ${item.title}`}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Deleting a campaign is irreversible and the messages already sent stay
          sent, so it asks first and names what is going. */}
      {deleteTarget && (
        <Modal
          title="Delete campaign"
          type="danger"
          confirmLabel="Delete"
          loading={busy}
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await deleteCampaign(deleteTarget.id);
              // If the queue currently open is the one being deleted, leave it
              // — otherwise the next mark would write to a document that no
              // longer exists.
              if (campaign?.id === deleteTarget.id) {
                setCampaign(null);
                setRecipients([]);
              }
              setDeleteTarget(null);
              showSuccess('Campaign deleted.');
              await loadHistory();
            } catch (error) {
              logger.error('Campaign delete failed', error);
              showError(error?.message ?? 'Could not delete that campaign.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="mb-2">
            Delete <strong>{deleteTarget.title}</strong> and its recipient list?
          </p>
          <p className="text-muted small mb-0">
            {deleteTarget.sentCount ?? 0} message
            {(deleteTarget.sentCount ?? 0) === 1 ? ' has' : 's have'} already been sent. Those
            are not recalled — only the record here is removed, and it cannot be undone.
          </p>
        </Modal>
      )}
    </motion.div>
  );
}
