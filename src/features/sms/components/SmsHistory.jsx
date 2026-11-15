import { useCallback, useEffect, useMemo, useState } from 'react';
import { listSms, getSms, refreshSms } from '@services/api/sms';
import { listCampaigns } from '@services/api/whatsapp';

/**
 * Sent messages — 008Fixes / 09 (owner: confirmation per person plus totals).
 * SMS sent through HashBack with their delivery, and the old WhatsApp
 * campaigns kept as read-only history (the WhatsApp queue is retired).
 * Read when opened and on Refresh; nothing listens.
 */

const STATUS = {
  queued: ['Waiting', 'text-bg-light border'],
  sending: ['Sending', 'text-bg-light border'],
  sent: ['Sent', 'text-bg-info'],
  delivered: ['Delivered', 'text-bg-success'],
  failed: ['Failed', 'text-bg-danger'],
  skipped: ['Not sent', 'text-bg-secondary'],
};
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export function Totals({ counts }) {
  const c = counts ?? {};
  const parts = [
    ['sent', (c.sent ?? 0) + (c.delivered ?? 0) + (c.failed ?? 0)],
    ['delivered', c.delivered ?? 0],
    ['failed', c.failed ?? 0],
    ['waiting', (c.sent ?? 0) + (c.queued ?? 0)],
  ];
  return (
    <div className="small" data-testid="sms-totals">
      {parts.map(([k, v], i) => <span key={k}>{i ? ' · ' : ''}<strong>{v}</strong> {k}</span>)}
    </div>
  );
}

export function SmsDetail({ campaignId, onBack }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    setError('');
    try {
      setData(await (refresh ? refreshSms(campaignId) : getSms(campaignId)));
    } catch (err) {
      setError(err?.message || 'Could not load this message.');
    } finally {
      setBusy(false);
    }
  }, [campaignId]);
  // Opening asks HashBack once (owner answer 5: a refresh when a message is opened).
  useEffect(() => { load(true); }, [load]);

  const people = useMemo(() => (data?.recipients ?? []).filter((r) => !filter || r.status === filter), [data, filter]);

  return (
    <div data-testid="sms-detail">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        {onBack && <button type="button" className="btn btn-sm btn-link px-0" onClick={onBack}><i className="bi bi-arrow-left me-1" aria-hidden="true" />All messages</button>}
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => load(true)} disabled={busy}>
          <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />{busy ? 'Checking…' : 'Refresh'}
        </button>
      </div>
      {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
      {data && (
        <>
          <p className="small text-muted mb-1">{when(data.campaign.createdAt)} · {data.campaign.recipientCount} people · KES {Number(data.campaign.sentCost || data.campaign.cost || 0).toFixed(2)}</p>
          <p className="border rounded p-2 small bg-light" style={{ whiteSpace: 'pre-wrap' }}>{data.campaign.template}</p>
          <Totals counts={data.campaign.counts} />
          <div className="d-flex flex-wrap gap-1 my-2" role="group" aria-label="Show">
            {['', 'delivered', 'sent', 'failed', 'queued'].map((s) => (
              <button key={s || 'all'} type="button" className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setFilter(s)}>
                {s ? STATUS[s][0] : 'Everyone'}
              </button>
            ))}
          </div>
          <ul className="list-group list-group-flush border rounded" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {people.length === 0 && <li className="list-group-item small text-muted">Nobody here.</li>}
            {people.map((r) => {
              const [label, cls] = STATUS[r.status] ?? [r.status, 'text-bg-light border'];
              return (
                <li key={r.id} className="list-group-item d-flex justify-content-between align-items-center py-1 gap-2" data-testid="sms-person">
                  <span className="text-truncate">{r.studentName ?? 'No name'} <span className="small text-muted">· …{r.phoneEnding}</span></span>
                  <span className={`badge ${cls}`} title={r.error ?? undefined}>{label}{r.status === 'failed' && r.refunded ? ' (refunded)' : ''}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default function SmsHistory() {
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [sms, wa] = await Promise.all([listSms(), listCampaigns().catch(() => ({ campaigns: [] }))]);
      setItems([
        ...(sms.campaigns ?? []).map((c) => ({ ...c, channel: 'sms' })),
        ...(wa.campaigns ?? []).map((c) => ({ id: c.id, channel: 'whatsapp', title: c.title, template: c.messageTemplate, createdAt: c.createdAt, recipientCount: c.recipientCount, sentCount: c.sentCount })),
      ].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))));
    } catch (err) {
      setError(err?.message || 'Could not load sent messages.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (open) return <SmsDetail campaignId={open} onBack={() => { setOpen(null); load(); }} />;
  if (error) return <div className="alert alert-danger small" role="alert">{error}</div>;
  if (!items) return <div className="text-muted small">Loading…</div>;
  if (items.length === 0) return <div className="text-muted small">Nothing sent yet.</div>;
  return (
    <ul className="list-group" data-testid="sms-history">
      {items.map((c) => (
        <li key={`${c.channel}-${c.id}`} className="list-group-item">
          <div className="d-flex justify-content-between gap-2 flex-wrap">
            <div className="text-truncate" style={{ maxWidth: '100%' }}>
              <span className={`badge me-2 ${c.channel === 'sms' ? 'text-bg-primary' : 'text-bg-success'}`}>{c.channel === 'sms' ? 'SMS' : 'WhatsApp'}</span>
              <span className="small">{(c.title || c.template || '').slice(0, 80)}</span>
            </div>
            <span className="small text-muted">{when(c.createdAt)}</span>
          </div>
          {c.channel === 'sms' ? (
            <div className="d-flex justify-content-between align-items-center mt-1 gap-2 flex-wrap">
              <Totals counts={c.counts} />
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setOpen(c.id)}>Delivery</button>
            </div>
          ) : (
            <div className="small text-muted mt-1">{c.sentCount ?? 0} of {c.recipientCount ?? 0} opened in WhatsApp (old campaign)</div>
          )}
        </li>
      ))}
    </ul>
  );
}
