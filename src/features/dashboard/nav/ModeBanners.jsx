import { useModes } from '@shared/config/modesStore';

/**
 * 013Fixes / 33: what the superadmin's switches mean for the teacher, shown
 * while they are on. Nothing when every switch is normal.
 */
export default function ModeBanners() {
  const modes = useModes();
  const notes = [];
  if (modes.paymentsTest) notes.push({ id: 'payments', icon: 'bi-credit-card', text: 'Test payments: no real money. Plan payments made now are test payments.' });
  if (modes.smsFake) notes.push({ id: 'sms', icon: 'bi-chat-dots', text: 'SMS are not being sent: messages are recorded as fake.' });
  if (notes.length === 0) return null;
  return (
    <div className="container-fluid pt-2" data-testid="mode-banners">
      {notes.map((n) => (
        <div key={n.id} className="alert alert-warning py-2 px-3 small mb-2" role="status" data-testid={`mode-banner-${n.id}`}>
          <i className={`bi ${n.icon} me-2`} aria-hidden="true" />
          {n.text}
        </div>
      ))}
    </div>
  );
}
