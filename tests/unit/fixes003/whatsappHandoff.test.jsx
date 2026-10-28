import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, renderHook, within } from '@testing-library/react';

/**
 * 003Fixes / 09 — after a bulk block, Recent actions offers "WhatsApp parents"
 * (Gold + whatsapp.advanced): the WhatsApp panel opens with exactly the blocked
 * students' parents and an editable draft. Optional: nothing is sent unless
 * the teacher starts the campaign as usual.
 */

const api = vi.hoisted(() => ({
  listBulkActions: vi.fn(), undoBulk: vi.fn(), listBulkItems: vi.fn(),
  BulkInterrupted: class extends Error {}, DEFAULT_LIMITS: {},
}));
vi.mock('@services/api/students', () => api);
const wa = vi.hoisted(() => ({
  createCampaign: vi.fn(), getCampaign: vi.fn(), listCampaigns: vi.fn(), markRecipient: vi.fn(), completeCampaign: vi.fn(),
  abandonCampaign: vi.fn(), deleteCampaign: vi.fn(), uploadAttachment: vi.fn(), getCampaignOptions: vi.fn(),
}));
vi.mock('@services/api/whatsapp', () => wa);
const who = vi.hoisted(() => ({ tierRank: 3 }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: who.tierRank, isSuperadmin: false }) }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => true }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }), useOptionalToast: () => null }));

beforeEach(() => {
  who.tierRank = 3;
  sessionStorage.clear();
  for (const fn of [...Object.values(api), ...Object.values(wa)]) if (fn?.mockReset) fn.mockReset();
  wa.listCampaigns.mockResolvedValue({ campaigns: [] });
  wa.getCampaignOptions.mockResolvedValue({ sessions: [], classes: [], students: [] });
  api.listBulkActions.mockResolvedValue({ actions: [
    { id: 'B1', action: 'block', kind: 'fees', amount: 1500, status: 'done', createdAtMs: Date.now(), undoUntilMs: Date.now() + 1_500_000, counts: { done: 2 } },
    { id: 'B2', action: 'unblock', status: 'done', createdAtMs: Date.now(), undoUntilMs: Date.now() + 1_500_000, counts: { done: 3 } },
  ] });
  api.listBulkItems.mockResolvedValue({ items: [{ session: 'morning', phone: '+254711000001' }, { session: 'evening', phone: '+254711000002' }] });
});
afterEach(() => cleanup());

async function openRecent() {
  const { default: RecentActionsPanel } = await import('@features/dashboard/components/bulk/RecentActionsPanel.jsx');
  const onClose = vi.fn();
  render(<RecentActionsPanel onClose={onClose} />);
  return { items: await screen.findAllByTestId('recent-action'), onClose };
}

describe('Recent actions → WhatsApp parents', () => {
  it('offered on a block (not an unblock); prepares the parents of exactly those students, then closes', async () => {
    const { items, onClose } = await openRecent();
    expect(within(items[1]).queryByRole('button', { name: /WhatsApp parents/ })).toBeNull();
    await act(async () => { fireEvent.click(within(items[0]).getByRole('button', { name: /WhatsApp parents/ })); });
    expect(api.listBulkItems).toHaveBeenCalledWith('B1');
    const { useWhatsappPreset } = await import('@features/whatsapp/whatsappPreset');
    const { result } = renderHook(() => useWhatsappPreset());
    expect(result.current.preset.filterValues).toEqual(['morning:+254711000001', 'evening:+254711000002']);
    expect(result.current.preset.template).toMatch(/until the fee of \{\{balance\}\} is paid/);
    expect(onClose).toHaveBeenCalled();
  });

  it('not offered below Gold', async () => {
    who.tierRank = 2;
    const { items } = await openRecent();
    expect(within(items[0]).queryByRole('button', { name: /WhatsApp parents/ })).toBeNull();
  });
});

describe('the WhatsApp panel with a preset', () => {
  it('shows the prepared recipients and draft; starting sends exactly those (session, number) pairs', async () => {
    wa.createCampaign.mockResolvedValue({ ok: true, campaignId: 'C1', recipientCount: 2 });
    wa.getCampaign.mockResolvedValue({ campaign: { id: 'C1', status: 'in_progress' }, recipients: [] });
    const { default: WhatsAppPanel } = await import('@features/whatsapp/components/WhatsAppPanel.jsx');
    const preset = { title: 'Blocked students', template: 'Dear parent, {{studentName}}', filterValues: ['morning:+254711000001', 'evening:+254711000002'], note: 'of the students blocked by this action' };
    render(<WhatsAppPanel preset={preset} />);
    expect(screen.getByTestId('wa-preset-recipients').textContent).toMatch(/2 parents of the students blocked by this action/);
    // No student list is fetched while the prepared list is shown.
    expect(wa.getCampaignOptions).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message').value).toBe('Dear parent, {{studentName}}');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Review recipients/ })); });
    expect(wa.createCampaign).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Blocked students',
      filter: expect.objectContaining({ type: 'individual', values: ['morning:+254711000001', 'evening:+254711000002'] }),
    }));
  });

  it('"Choose students instead" clears the prepared list', async () => {
    const { default: WhatsAppPanel } = await import('@features/whatsapp/components/WhatsAppPanel.jsx');
    render(<WhatsAppPanel preset={{ title: 't', template: 'm', filterValues: ['morning:+254711000001'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose students instead' }));
    expect(screen.queryByTestId('wa-preset-recipients')).toBeNull();
  });
});
