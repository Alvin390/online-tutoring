import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, renderHook, within } from '@testing-library/react';

/**
 * 003Fixes / 09 — after a bulk block, Recent actions offers to message the
 * blocked students' parents (Gold + whatsapp.advanced): the Messages tab opens
 * with exactly those parents and an editable draft. Optional: nothing is sent
 * unless the teacher sends it.
 * 008Fixes / 11: by SMS ("SMS parents"), so only with sms.enabled on; the old
 * WhatsApp panel is removed (the composer's handling of the draft is in
 * tests/unit/fixes008/composer.test.jsx).
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
const flags = vi.hoisted(() => ({ 'sms.enabled': true, 'whatsapp.advanced': true }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => flags[k] === true }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }), useOptionalToast: () => null }));

beforeEach(() => {
  who.tierRank = 3;
  flags['sms.enabled'] = true;
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

describe('Recent actions → SMS parents', () => {
  it('offered on a block (not an unblock); prepares the parents of exactly those students, then closes', async () => {
    const { items, onClose } = await openRecent();
    expect(within(items[1]).queryByRole('button', { name: /SMS parents/ })).toBeNull();
    await act(async () => { fireEvent.click(within(items[0]).getByRole('button', { name: /SMS parents/ })); });
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
    expect(within(items[0]).queryByRole('button', { name: /SMS parents/ })).toBeNull();
  });

  it('not offered with SMS off (several parents at once need SMS)', async () => {
    flags['sms.enabled'] = false;
    const { items } = await openRecent();
    expect(within(items[0]).queryByRole('button', { name: /parents/ })).toBeNull();
  });
});
