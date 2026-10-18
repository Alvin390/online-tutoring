import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Phase 13 / 02 — client side of sessions and class links.
 *   D4 one link slot per session (incl. the 5-session check)
 *   D5 homepage cards from data, D8 the session editor, I1 no hard-coding
 */

const session = (id, extra = {}) => ({
  id,
  slug: id,
  name: `${id[0].toUpperCase()}${id.slice(1)} Class`,
  active: true,
  order: 0,
  icon: 'bi-book-fill',
  gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  description: '',
  schedule: null,
  ...extra,
});

// ---------------------------------------------------------------------------
describe('D4 ClassLinkManager — one slot per session', () => {
  let ClassLinkManager;
  beforeEach(async () => {
    ({ default: ClassLinkManager } = await import('@/features/dashboard/components/ClassLinkManager.jsx'));
  });

  it('five sessions → five link fields in order, five share links, and a warning for the three unset', () => {
    const sessions = ['morning', 'evening', 'weekend', 'saturday', 'holiday'].map((id, i) => session(id, { order: i }));
    const classLinks = {
      morning: { url: 'https://zoom.us/j/1111111111', provider: 'zoom' },
      evening: { url: 'https://zoom.us/j/2222222222', provider: 'zoom' },
    };
    render(<ClassLinkManager sessions={sessions} classLinks={classLinks} onUpdate={vi.fn()} loading={false} />);

    const rows = screen.getAllByTestId(/^link-row-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      'link-row-morning', 'link-row-evening', 'link-row-weekend', 'link-row-saturday', 'link-row-holiday',
    ]);
    expect(screen.getByRole('alert').textContent).toMatch(/3 sessions have no class link yet/);
    expect(screen.getAllByRole('button', { name: /Copy .* registration link/ })).toHaveLength(5);
    expect(screen.getByDisplayValue(`${window.location.origin}/holiday`)).toBeTruthy();
  });

  it('a newly added session gets its slot on the next render, no reload', () => {
    const { rerender } = render(
      <ClassLinkManager sessions={[session('morning')]} classLinks={{}} onUpdate={vi.fn()} loading={false} />
    );
    expect(screen.getAllByTestId(/^link-row-/)).toHaveLength(1);
    rerender(
      <ClassLinkManager sessions={[session('morning'), session('weekend')]} classLinks={{}} onUpdate={vi.fn()} loading={false} />
    );
    expect(screen.getByTestId('link-row-weekend')).toBeTruthy();
  });

  it('saves each link against its own session', async () => {
    const onUpdate = vi.fn().mockResolvedValue({ success: true });
    render(<ClassLinkManager sessions={[session('morning'), session('weekend')]} classLinks={{}} onUpdate={onUpdate} loading={false} />);
    const row = screen.getByTestId('link-row-weekend');
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: 'https://zoom.us/j/3131313131' } });
    fireEvent.click(within(row).getByRole('button', { name: /Add Link/ }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('weekend', 'https://zoom.us/j/3131313131'));
  });

  it('hidden sessions keep a (collapsed) slot', () => {
    render(
      <ClassLinkManager sessions={[session('morning'), session('paused', { active: false })]} classLinks={{}} onUpdate={vi.fn()} loading={false} />
    );
    expect(screen.queryByTestId('link-row-paused')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Hidden sessions \(1\)/ }));
    expect(screen.getByTestId('link-row-paused')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('D5 SessionCard', () => {
  it('renders the bootstrap defaults exactly like the old homepage', async () => {
    const { default: SessionCard } = await import('@/features/sessions/components/SessionCard.jsx');
    const { FALLBACK_SESSIONS } = await import('@shared/constants/sessions');
    render(<MemoryRouter><SessionCard session={FALLBACK_SESSIONS[0]} /></MemoryRouter>);
    expect(screen.getByText('Morning Session')).toBeTruthy();
    expect(screen.getByText('8:00 AM – 12:00 PM')).toBeTruthy();
    expect(screen.getByText('Start your day with focused learning and interactive classes')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/morning');
  });

  it('hides the time and description lines when not set', async () => {
    const { default: SessionCard } = await import('@/features/sessions/components/SessionCard.jsx');
    render(<MemoryRouter><SessionCard session={session('weekend')} /></MemoryRouter>);
    expect(screen.queryByText(/AM|PM/)).toBeNull();
    expect(document.querySelector('.session-card-description')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('D5 usePublicSessions', () => {
  beforeEach(() => vi.resetModules());

  it('returns active sessions sorted by order', async () => {
    vi.doMock('firebase/firestore', () => ({
      collection: vi.fn(), query: vi.fn(), where: vi.fn(),
      getDocs: vi.fn().mockResolvedValue({
        docs: [
          { id: 'weekend', data: () => ({ name: 'Weekend', order: 2, active: true }) },
          { id: 'morning', data: () => ({ name: 'Morning', order: 0, active: true }) },
        ],
      }),
    }));
    vi.doMock('@services/firebase/config', () => ({ db: {} }));
    const { usePublicSessions } = await import('@/features/sessions/hooks/usePublicSessions.js');
    const { result } = renderHook(() => usePublicSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions.map((s) => s.id)).toEqual(['morning', 'weekend']);
    expect(result.current.fallback).toBe(false);
  });

  it('falls back to morning + evening on a failed read', async () => {
    vi.doMock('firebase/firestore', () => ({
      collection: vi.fn(), query: vi.fn(), where: vi.fn(),
      getDocs: vi.fn().mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' })),
    }));
    vi.doMock('@services/firebase/config', () => ({ db: {} }));
    const { usePublicSessions } = await import('@/features/sessions/hooks/usePublicSessions.js');
    const { result } = renderHook(() => usePublicSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions.map((s) => s.id)).toEqual(['morning', 'evening']);
    expect(result.current.fallback).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('D8 SessionEditor', () => {
  let SessionEditor;
  beforeEach(async () => {
    vi.resetModules();
    ({ default: SessionEditor } = await import('@/features/sessions/components/SessionEditor.jsx'));
  });

  const morning = {
    id: 'morning', name: 'Morning Session', active: true,
    description: 'Start your day with focused learning and interactive classes',
    schedule: { days: [], startTime: '08:00', endTime: '12:00', tz: 'Africa/Nairobi' },
    icon: 'bi-sunrise-fill', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  };

  it('pre-fills from the document and previews live as the teacher types', () => {
    render(<SessionEditor session={morning} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Session name').value).toBe('Morning Session');
    expect(screen.getByLabelText('Start time').value).toBe('08:00');
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Early Birds' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '10:30' } });
    const preview = screen.getByTestId('session-card-morning');
    expect(within(preview).getByText('Early Birds')).toBeTruthy();
    expect(within(preview).getByText('8:00 AM – 10:30 AM')).toBeTruthy();
  });

  it('shows an inline error when the end is not after the start, and does not save', () => {
    const onSave = vi.fn();
    render(<SessionEditor session={morning} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '07:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('alert').textContent).toMatch(/end time must be after the start/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves only the changed fields', () => {
    const onSave = vi.fn();
    render(<SessionEditor session={morning} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Fresh minds.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSave).toHaveBeenCalledWith({
      description: 'Fresh minds.',
      schedule: { days: [3], startTime: '08:00', endTime: '12:00', tz: 'Africa/Nairobi' },
    });
  });

  it('keeps the registration link read-only with a copy button when editing', () => {
    render(<SessionEditor session={morning} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Registration link').readOnly).toBe(true);
    expect(screen.getByRole('button', { name: 'Copy registration link' })).toBeTruthy();
  });

  it('creating: derives the link from the name and sends every field', () => {
    const onSave = vi.fn();
    render(<SessionEditor onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Saturday Revision' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '12:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'saturday-revision', name: 'Saturday Revision', active: true,
      schedule: { days: [6], startTime: '09:00', endTime: '12:00', tz: 'Africa/Nairobi' },
    }));
  });

  it('the defaults get the same editor as any session', () => {
    const { container: a } = render(<SessionEditor session={morning} onSave={vi.fn()} onCancel={vi.fn()} />);
    const { container: b } = render(<SessionEditor session={{ ...morning, id: 'weekend', name: 'Weekend' }} onSave={vi.fn()} onCancel={vi.fn()} />);
    const fields = (c) => [...c.querySelectorAll('input, textarea')].map((el) => el.type).join(',');
    expect(fields(a)).toBe(fields(b));
  });
});

// ---------------------------------------------------------------------------
describe('I1 no hard-coded sessions', () => {
  const ROOT = process.cwd();
  // Comments are stripped so documentation may mention the defaults by name.
  const code = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it.each([
    'src/features/dashboard/components/ClassLinkManager.jsx',
    'src/pages/LandingPage.jsx',
    'src/features/dashboard/components/DashboardLayout.jsx',
    'src/features/dashboard/components/StatsCards.jsx',
    'src/features/dashboard/components/SessionManager.jsx',
  ])('%s names no session literally', (rel) => {
    expect(code(rel)).not.toMatch(/['"`/](morning|evening)['"`]/);
  });
});

// ---------------------------------------------------------------------------
describe('client and server default sessions agree', () => {
  it('DEFAULT_SESSIONS are identical', async () => {
    const client = await import('@shared/constants/sessions');
    const server = await import('../../../api/_lib/sessions.js');
    expect(JSON.parse(JSON.stringify(client.DEFAULT_SESSIONS))).toEqual(JSON.parse(JSON.stringify(server.DEFAULT_SESSIONS)));
  });
});
