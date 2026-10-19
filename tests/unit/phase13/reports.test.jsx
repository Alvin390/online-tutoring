import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';

/**
 * Phase 13 / 06 — the Help & feedback form, screenshot compression, and the
 * superadmin inbox and settings card.
 */

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
});
afterEach(() => cleanup());

const BUG_DISCLAIMER = 'Thank you for telling us — every report makes the platform better for you and your students. We\'ll get back to you within 36 hours at the very most, and usually much sooner.';
const FEATURE_DISCLAIMER = 'We love hearing what would make your teaching easier! New features are custom work, so each one carries an extra cost — we\'ll send you a clear quote before anything begins, and you\'ll hear back from us within 3 working days.';

// ---------------------------------------------------------------------------
describe('client constants match the server', () => {
  it('size caps, attachment count and status workflows agree', async () => {
    const client = await import('@features/reports/constants');
    const server = await import('../../../api/_lib/reports.js');
    expect(client.MAX_FULL_BYTES).toBe(server.MAX_FULL_BYTES);
    expect(client.MAX_THUMB_BYTES).toBe(server.MAX_THUMB_BYTES);
    expect(client.MAX_ATTACHMENTS).toBe(server.MAX_ATTACHMENTS);
    expect(client.BUG_STATUSES).toEqual([...server.BUG_STATUSES]);
    expect(client.FEATURE_STATUSES).toEqual([...server.FEATURE_STATUSES]);
    expect(client.SEVERITIES.map((s) => s.id)).toEqual([...server.SEVERITIES]);
    expect(client.URGENCIES.map((u) => u.id)).toEqual([...server.URGENCIES]);
  });
});

// ---------------------------------------------------------------------------
describe('compressImage (canvas mocked)', () => {
  const file = (type = 'image/png', size = 2_000_000) => ({ type, size });
  const bitmap = (w = 3000, h = 2000) => ({ width: w, height: h, close: vi.fn() });
  const blob = (type, size) => ({ type, size });

  it('scales the long edge to 1600 px and encodes WebP at 0.8', async () => {
    const { compressImage } = await import('@features/reports/utils/compressImage');
    const bm = bitmap();
    const encode = vi.fn(async (_b, w, h, type) => blob(type, w > 400 ? 120_000 : 20_000));
    const out = await compressImage(file(), { decode: async () => bm, encode });
    expect(out.full).toMatchObject({ width: 1600, height: 1067, type: 'image/webp' });
    expect(encode.mock.calls[0].slice(1)).toEqual([1600, 1067, 'image/webp', 0.8]);
    expect(out.thumb).toMatchObject({ width: 320, height: 213 });
    expect(bm.close).toHaveBeenCalled();
  });

  it('re-encodes at 0.65 when 0.8 is over the 185 KB server cap', async () => {
    const { compressImage } = await import('@features/reports/utils/compressImage');
    const encode = vi.fn(async (_b, w, _h, type, q) => blob(type, w <= 320 ? 10_000 : q === 0.8 ? 250_000 : 150_000));
    const out = await compressImage(file(), { decode: async () => bitmap(), encode });
    expect(out.full.blob.size).toBe(150_000);
    expect(encode.mock.calls.slice(0, 2).map((c) => c[4])).toEqual([0.8, 0.65]);
  });

  it('then shrinks the image until it fits', async () => {
    const { compressImage } = await import('@features/reports/utils/compressImage');
    const encode = vi.fn(async (_b, w, _h, type) => blob(type, w > 1000 ? 400_000 : 100_000));
    const out = await compressImage(file(), { decode: async () => bitmap(), encode });
    expect(out.full.width).toBeLessThanOrEqual(1000);
    expect(out.full.blob.size).toBe(100_000);
  });

  it('switches to JPEG when the browser cannot encode WebP', async () => {
    const { compressImage } = await import('@features/reports/utils/compressImage');
    const encode = vi.fn(async (_b, _w, _h, type) => blob(type === 'image/webp' ? 'image/png' : type, 90_000));
    const out = await compressImage(file(), { decode: async () => bitmap(), encode });
    expect(out.full.type).toBe('image/jpeg');
  });

  it('refuses files over 10 MB and non-images before decoding', async () => {
    const { compressImage, CompressError } = await import('@features/reports/utils/compressImage');
    const decode = vi.fn();
    await expect(compressImage(file('image/png', 11 * 1024 * 1024), { decode })).rejects.toThrow(/10 MB/);
    await expect(compressImage(file('image/svg+xml', 1000), { decode })).rejects.toBeInstanceOf(CompressError);
    expect(decode).not.toHaveBeenCalled();
  });

  it('gives a clear error when even 480 px will not fit, and still frees the bitmap', async () => {
    const { compressImage } = await import('@features/reports/utils/compressImage');
    const bm = bitmap();
    const encode = vi.fn(async (_b, _w, _h, type) => blob(type, 900_000));
    await expect(compressImage(file(), { decode: async () => bm, encode })).rejects.toThrow(/too detailed/);
    expect(bm.close).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
async function renderModal({ submit } = {}) {
  const api = {
    submitReport: submit ?? vi.fn().mockResolvedValue({ ok: true, id: 'x', number: 'BUG-0007', responseDueAt: '2026-10-18T09:00:00.000Z' }),
    listMyReports: vi.fn().mockResolvedValue({ reports: [] }),
    uploadReportAttachment: vi.fn().mockResolvedValue({ ok: true }),
  };
  vi.doMock('@services/api/reports', () => api);
  vi.doMock('@features/auth/context/AuthContext', () => ({
    useAuthState: () => ({ tier: 'silver', user: { email: 'zoe@example.com' } }),
  }));
  vi.doMock('@features/reports/utils/compressImage', () => ({
    compressInBackground: vi.fn(async () => ({
      full: { blob: new Blob(['f'], { type: 'image/webp' }), width: 10, height: 10, type: 'image/webp' },
      thumb: { blob: new Blob(['t'], { type: 'image/webp' }), width: 5, height: 5, type: 'image/webp' },
    })),
    blobToBase64: vi.fn(async () => 'AAAA'),
    blobToDataUrl: vi.fn(async () => 'data:image/webp;base64,AAAA'),
  }));
  const { default: HelpFeedbackModal } = await import('@features/reports/components/HelpFeedbackModal');
  const onClose = vi.fn();
  const view = render(<HelpFeedbackModal onClose={onClose} />);
  return { api, onClose, view, HelpFeedbackModal };
}

const fillBug = () => {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Join button spins' } });
  fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'It spins forever on the evening page.' } });
  fireEvent.click(screen.getByLabelText(/Blocking/));
};

describe('Help & feedback modal', () => {
  it('shows each tab\'s disclaimer with the exact wording', async () => {
    await renderModal();
    expect(screen.getByTestId('report-disclaimer').textContent).toBe(BUG_DISCLAIMER);
    fireEvent.click(screen.getByRole('tab', { name: /Suggest a feature/ }));
    expect(screen.getByTestId('report-disclaimer').textContent).toBe(FEATURE_DISCLAIMER);
  });

  it('validates before sending (title, description, severity)', async () => {
    const { api } = await renderModal();
    fireEvent.click(screen.getByTestId('report-submit'));
    expect(await screen.findByText(/Give it a short title/)).toBeInTheDocument();
    expect(screen.getByText(/How much is this getting in your way/)).toBeInTheDocument();
    expect(api.submitReport).not.toHaveBeenCalled();
  });

  it('locks while sending, sends once, then shows the number and reply-by date', async () => {
    let resolve;
    const submit = vi.fn(() => new Promise((r) => { resolve = r; }));
    await renderModal({ submit });
    fillBug();
    const button = screen.getByTestId('report-submit');
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toMatchObject({ type: 'bug', title: 'Join button spins', severity: 'blocking', attachments: [] });
    expect(submit.mock.calls[0][0].reportId).toMatch(/^[0-9a-f-]{36}$/);

    await act(async () => { resolve({ ok: true, number: 'BUG-0007', responseDueAt: '2026-10-18T09:00:00.000Z' }); });
    expect(await screen.findByTestId('report-success')).toHaveTextContent(
      'Thanks! BUG-0007 is with us — expect a reply by Sun 18 Oct.'
    );
  });

  it('keeps the draft — text AND report id — across closing and reopening', async () => {
    const { view, HelpFeedbackModal } = await renderModal();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Half-written' } });
    view.unmount();
    render(<HelpFeedbackModal onClose={() => {}} />);
    expect(screen.getByLabelText('Title')).toHaveValue('Half-written');
    const saved = JSON.parse(sessionStorage.getItem('tutoring.reportDraft.v1'));
    expect(saved.reportId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('clears the draft and starts a new report id after sending', async () => {
    const { api } = await renderModal();
    const before = JSON.parse(sessionStorage.getItem('tutoring.reportDraft.v1') ?? 'null')?.reportId;
    fillBug();
    fireEvent.click(screen.getByTestId('report-submit'));
    await screen.findByTestId('report-success');
    expect(sessionStorage.getItem('tutoring.reportDraft.v1')).toBeNull();
    fireEvent.click(screen.getByText('Send another'));
    const next = JSON.parse(sessionStorage.getItem('tutoring.reportDraft.v1')).reportId;
    expect(next).not.toBe(api.submitReport.mock.calls[0][0].reportId);
    expect(before === null || next !== before).toBe(true);
  });

  it('pasting an image adds a thumbnail, uploads it, and the submit carries it', async () => {
    const { api } = await renderModal();
    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await act(async () => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      event.clipboardData = { files: [png] };
      document.dispatchEvent(event);
    });
    expect(await screen.findAllByTestId('report-thumb')).toHaveLength(1);
    await waitFor(() => expect(api.uploadReportAttachment).toHaveBeenCalledTimes(2));
    expect(api.uploadReportAttachment.mock.calls.map((c) => c[0].variant)).toEqual(['full', 'thumb']);
    expect(api.uploadReportAttachment.mock.calls[0][0]).toMatchObject({ index: 0, contentType: 'image/webp', data: 'AAAA' });

    fillBug();
    await waitFor(() => expect(screen.getByTestId('report-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('report-submit'));
    await screen.findByTestId('report-success');
    expect(api.submitReport.mock.calls[0][0].attachments).toEqual([{ index: 0 }]);
  });
});

// ---------------------------------------------------------------------------
describe('superadmin inbox', () => {
  it('dueState: amber in the last quarter, red when overdue', async () => {
    const { dueState } = await import('@features/reports/components/ReportsInbox');
    const created = '2026-10-16T00:00:00.000Z';
    const due = '2026-10-17T12:00:00.000Z'; // 36 h window
    expect(dueState(created, due, Date.parse('2026-10-16T06:00:00Z')).tone).toBe('ok');
    expect(dueState(created, due, Date.parse('2026-10-17T05:00:00Z')).tone).toBe('soon');
    expect(dueState(created, due, Date.parse('2026-10-17T13:00:00Z'))).toMatchObject({ tone: 'overdue', label: 'Overdue by 1h' });
  });

  it('each inbox asks only for its own type, and a status change shows in the list', async () => {
    const item = { id: 'r1', type: 'bug', number: 'BUG-0001', title: 'Broken', status: 'new', teacher: 'Zoë', createdAt: new Date().toISOString(), responseDueAt: new Date(Date.now() + 3_600_000).toISOString(), attachments: 0 };
    const api = {
      // Stateful, like the server: a status change shows on the next list.
      listReports: vi.fn(async () => ({ items: [{ ...item }], counts: { [item.status]: 1 }, nextCursor: null })),
      getReport: vi.fn().mockResolvedValue({ report: { ...item, description: 'd', email: { status: 'sent' }, internalNotes: [], attachments: [], context: {} } }),
      setReportStatus: vi.fn(async ({ status }) => { item.status = status; return { ok: true }; }),
      addReportNote: vi.fn(), resendReportEmail: vi.fn(),
    };
    vi.doMock('@services/api/reports', () => api);
    const { default: ReportsInbox } = await import('@features/reports/components/ReportsInbox');
    render(<ReportsInbox type="bug" initialReportId="r1" />);

    await screen.findByTestId('report-detail');
    expect(api.listReports).toHaveBeenCalledWith({ type: 'bug', status: undefined, cursor: null });
    fireEvent.change(screen.getByTestId('report-status-select'), { target: { value: 'resolved' } });
    await waitFor(() => expect(api.setReportStatus).toHaveBeenCalledWith({ id: 'r1', status: 'resolved' }));
    await waitFor(() => expect(screen.getByTestId('inbox-bug')).toHaveTextContent('Resolved'));
  });

  it('the recipient form validates before saving', async () => {
    const api = {
      getNotificationSettings: vi.fn().mockResolvedValue({ reportRecipient: 'alvinmk06@gmail.com', gmail: { configured: true, sender: 's@example.com' } }),
      setReportRecipient: vi.fn().mockResolvedValue({ ok: true, reportRecipient: 'new@example.com' }),
      sendTestEmail: vi.fn(),
    };
    vi.doMock('@services/api/reports', () => api);
    const { default: Card } = await import('@features/reports/components/NotificationsSettingsCard');
    render(<Card />);
    const input = await screen.findByLabelText('Send reports to');
    expect(input).toHaveValue('alvinmk06@gmail.com');

    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(api.setReportRecipient).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Reports now go to new@example.com/)).toBeInTheDocument();
  });

  it('shows "Gmail disconnected — reconnect" when Google refused the token', async () => {
    vi.doMock('@services/api/reports', () => ({
      getNotificationSettings: vi.fn().mockResolvedValue({ reportRecipient: 'a@b.co', gmail: { configured: true, disconnected: true, lastError: 'invalid_grant' } }),
      setReportRecipient: vi.fn(), sendTestEmail: vi.fn(),
    }));
    const { default: Card } = await import('@features/reports/components/NotificationsSettingsCard');
    render(<Card />);
    expect(await screen.findByTestId('gmail-disconnected')).toHaveTextContent('Gmail disconnected — reconnect.');
  });
});
