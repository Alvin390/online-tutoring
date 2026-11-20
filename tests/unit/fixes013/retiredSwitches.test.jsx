import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { visibleTabs } from '@features/dashboard/nav/dashboardTabs';
import { MAX_CLASSES as CLIENT_MAX } from '@shared/constants/sessions';
import { MAX_CLASSES as SERVER_MAX } from '../../../api/_lib/sessions.js';

/**
 * 013Fixes / 06 — the old WhatsApp switches no longer decide anything: the
 * Messages tab is always there (one-to-one WhatsApp is on every plan), and
 * choosing SMS recipients is Gold's plan feature alone. The class ceiling is
 * technical (100), the same on both sides.
 */

const sms = vi.hoisted(() => ({
  listSmsPeople: vi.fn(), previewSms: vi.fn(), startSms: vi.fn(), sendSmsChunk: vi.fn(), cancelSms: vi.fn(),
  listSms: vi.fn(), getSms: vi.fn(), refreshSms: vi.fn(),
}));
vi.mock('@services/api/sms', () => sms);
vi.mock('@services/api/whatsapp', () => ({ listCampaigns: vi.fn().mockResolvedValue({ campaigns: [] }) }));
const auth = vi.hoisted(() => ({ tier: 'gold', tierRank: 3, isSuperadmin: false }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => auth }));
// Every switch off except SMS — whatsapp.broadcast and whatsapp.advanced included.
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => k === 'sms.enabled' }));

beforeEach(() => {
  sms.listSmsPeople.mockResolvedValue({ students: [{ session: 'evening', sessionName: 'Evening', phone: '+254711000001', studentName: 'Ann', class: 'Form 3' }], staff: [] });
});

describe('retired switches', () => {
  it('the Messages tab shows with whatsapp.broadcast off', () => {
    const ids = visibleTabs((flag) => flag === 'sms.enabled').map((t) => t.id);
    expect(ids).toContain('whatsapp');
  });

  it('Gold chooses recipients with whatsapp.advanced off', async () => {
    const { default: SmsComposer } = await import('@features/sms/components/SmsComposer');
    render(<SmsComposer setup={{ schoolName: 'Focus', unlocked: true }} />);
    await waitFor(() => expect(screen.getByTestId('sms-audience').textContent).toMatch(/1 person/));
    const classOption = screen.getByRole('option', { name: 'A class' });
    expect(classOption.disabled).toBe(false);
  });
});

describe('the class ceiling', () => {
  it('is 100 on both sides of the pair', () => {
    expect(SERVER_MAX).toBe(100);
    expect(CLIENT_MAX).toBe(SERVER_MAX);
  });
});
