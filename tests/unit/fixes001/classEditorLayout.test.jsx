import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

/**
 * 001Fixes / 02 — the class editor becomes two panes (classes on the left, the
 * selected class's subjects on the right), and every session row gets its own
 * "Classes & subjects" button that opens the editor straight on that tab.
 * What is saved is unchanged; only how the teacher gets there and moves around.
 */

beforeEach(() => vi.resetModules());
afterEach(() => {
  cleanup();
  vi.doUnmock('@features/sessions/hooks/useSessions');
});

const morning = {
  id: 'morning', name: 'Morning Session', active: true, description: '', order: 0,
  schedule: { days: [], startTime: '08:00', endTime: '12:00', tz: 'Africa/Nairobi' },
  icon: 'bi-sunrise-fill', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  classes: ['Grade 7', 'Grade 8', 'Grade 10', 'Form 3'],
};

async function renderEditor(session = morning) {
  const { default: SessionEditor } = await import('@/features/sessions/components/SessionEditor.jsx');
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<SessionEditor session={session} onSave={onSave} onCancel={vi.fn()} initialView="classes" />);
  return onSave;
}

const selectButton = (cls) => screen.getByRole('button', { name: `Show subjects for ${cls}` });
const selected = () => screen.getAllByRole('button', { name: /^Show subjects for / })
  .filter((b) => b.getAttribute('aria-current') === 'true')
  .map((b) => b.getAttribute('aria-label').replace('Show subjects for ', ''));
const paneHeading = () => screen.getByTestId('subjects-heading').textContent;

describe('two panes: classes, and the selected class\'s subjects', () => {
  it('the first class is selected on open, and its subjects are already showing', async () => {
    await renderEditor();
    expect(selected()).toEqual(['Grade 7']);
    expect(paneHeading()).toMatch(/Subjects for Grade 7/);
    expect(within(screen.getByTestId('subjects-0')).getAllByRole('textbox').length).toBeGreaterThan(1);
  });

  it('choosing a class shows its subjects; choosing it again keeps it (no collapse)', async () => {
    await renderEditor();
    fireEvent.click(selectButton('Form 3'));
    expect(selected()).toEqual(['Form 3']);
    expect(paneHeading()).toMatch(/Subjects for Form 3/);
    fireEvent.click(selectButton('Form 3'));
    expect(selected()).toEqual(['Form 3']);
    expect(screen.getByTestId('subjects-3')).toBeTruthy();
  });

  it('selection follows a move', async () => {
    await renderEditor();
    fireEvent.click(selectButton('Form 3'));
    fireEvent.click(screen.getByRole('button', { name: 'Move Form 3 up' }));
    expect(selected()).toEqual(['Form 3']);
    expect(screen.getByTestId('subjects-2')).toBeTruthy();
  });

  it('selection follows a rename', async () => {
    await renderEditor();
    fireEvent.click(selectButton('Grade 10'));
    fireEvent.change(screen.getByLabelText('Class 3'), { target: { value: 'Grade Ten' } });
    expect(paneHeading()).toMatch(/Subjects for Grade Ten/);
    expect(selected()).toEqual(['Grade Ten']);
  });

  it('removing the selected class selects its neighbour', async () => {
    await renderEditor();
    fireEvent.click(selectButton('Grade 8'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Grade 8' }));
    expect(selected()).toEqual(['Grade 10']);
    fireEvent.click(selectButton('Form 3'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Form 3' }));
    expect(selected()).toEqual(['Grade 10']);
  });

  it('removing a class above the selected one keeps the same class selected', async () => {
    await renderEditor();
    fireEvent.click(selectButton('Form 3'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Grade 7' }));
    expect(selected()).toEqual(['Form 3']);
    expect(paneHeading()).toMatch(/Subjects for Form 3/);
  });

  it('a newly added class is selected, ready for its subjects', async () => {
    await renderEditor();
    fireEvent.change(screen.getByLabelText('New class name'), { target: { value: 'Adult Class' } });
    fireEvent.keyDown(screen.getByLabelText('New class name'), { key: 'Enter' });
    expect(selected()).toEqual(['Adult Class']);
    expect(screen.getByText(/students in this class type their subjects instead/)).toBeTruthy();
  });

  it('arrow keys move the selection between classes', async () => {
    await renderEditor();
    selectButton('Grade 7').focus();
    fireEvent.keyDown(selectButton('Grade 7'), { key: 'ArrowDown' });
    expect(selected()).toEqual(['Grade 8']);
    expect(document.activeElement).toBe(selectButton('Grade 8'));
    fireEvent.keyDown(selectButton('Grade 8'), { key: 'End' });
    expect(selected()).toEqual(['Form 3']);
    fireEvent.keyDown(selectButton('Form 3'), { key: 'ArrowUp' });
    expect(selected()).toEqual(['Grade 10']);
    fireEvent.keyDown(selectButton('Grade 10'), { key: 'Home' });
    expect(selected()).toEqual(['Grade 7']);
  });

  it('"Back to classes" (phones) returns focus to the selected class', async () => {
    await renderEditor();
    fireEvent.click(selectButton('Form 3'));
    fireEvent.click(screen.getByRole('button', { name: /Back to classes/ }));
    expect(document.activeElement).toBe(selectButton('Form 3'));
  });

  it('the save payload is unchanged by the new layout', async () => {
    const onSave = await renderEditor();
    fireEvent.click(selectButton('Form 3'));
    fireEvent.change(screen.getByLabelText('New subject for Form 3'), { target: { value: 'Biology' } });
    fireEvent.keyDown(screen.getByLabelText('New subject for Form 3'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(Object.keys(onSave.mock.calls[0][0])).toEqual(['subjectsByClass']);
    expect(onSave.mock.calls[0][0].subjectsByClass['Form 3'].at(-1)).toEqual({ name: 'Biology', compulsory: false });
  });
});

// ---------------------------------------------------------------------------
describe('a "Classes & subjects" button on every session row', () => {
  async function renderManager(sessions = [morning, { ...morning, id: 'evening', name: 'Evening Session', order: 1, classes: undefined }]) {
    const updateSession = vi.fn().mockResolvedValue({ success: true });
    vi.doMock('@features/sessions/hooks/useSessions', () => ({
      useSessions: () => ({
        sessions, loading: false, busy: false, updateSession,
        createSession: vi.fn(), deleteSession: vi.fn(), toggleActive: vi.fn(), reorderSessions: vi.fn(),
      }),
    }));
    const { default: SessionManager } = await import('@/features/dashboard/components/SessionManager.jsx');
    render(<SessionManager />);
    return { updateSession };
  }

  const rowButton = (name) => screen.getByRole('button', { name: new RegExp(`Classes & subjects for ${name}`) });
  const pencil = (name) => screen.getByRole('button', { name: `Edit ${name}` });
  const tab = (name) => screen.getByRole('tab', { name });

  it('shows how many classes each session offers (defaults when it has no list)', async () => {
    await renderManager([morning, { ...morning, id: 'saturday', name: 'Saturday', classes: ['Grade 9', 'Form 1'] }, { ...morning, id: 'evening', name: 'Evening Session', classes: undefined }]);
    expect(rowButton('Morning Session').textContent).toMatch(/4 classes & subjects/);
    expect(rowButton('Saturday').textContent).toMatch(/2 classes & subjects/);
    expect(rowButton('Evening Session').textContent).toMatch(/4 classes & subjects/);
  });

  it('opens the editor straight on the Classes & subjects tab; the pencil opens Details', async () => {
    await renderManager();
    fireEvent.click(rowButton('Morning Session'));
    await screen.findByRole('tablist'); // the editor is lazy-loaded
    expect(tab(/Classes & subjects/).getAttribute('aria-selected')).toBe('true');
    expect(rowButton('Morning Session').getAttribute('aria-expanded')).toBe('true');
    expect(pencil('Morning Session').getAttribute('aria-expanded')).toBe('false');
    cleanup();
    await renderManager();
    fireEvent.click(pencil('Morning Session'));
    await screen.findByRole('tablist');
    expect(tab(/Details/).getAttribute('aria-selected')).toBe('true');
  });

  it('switching between the two buttons keeps unsaved edits; pressing the open one again closes', async () => {
    await renderManager();
    fireEvent.click(rowButton('Morning Session'));
    fireEvent.click(await screen.findByRole('button', { name: 'Move Grade 8 up' }));
    expect(screen.getByTestId('unsaved-pill')).toBeTruthy();

    fireEvent.click(pencil('Morning Session'));
    expect(tab(/Details/).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('unsaved-pill')).toBeTruthy();

    fireEvent.click(rowButton('Morning Session'));
    expect(tab(/Classes & subjects/).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByTestId('class-list')).getAllByRole('textbox').map((i) => i.value))
      .toEqual(['Grade 8', 'Grade 7', 'Grade 10', 'Form 3']);

    fireEvent.click(rowButton('Morning Session'));
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('the editor\'s own tabs keep the row buttons in step', async () => {
    await renderManager();
    fireEvent.click(pencil('Morning Session'));
    fireEvent.click(await screen.findByRole('tab', { name: /Classes & subjects/ }));
    expect(rowButton('Morning Session').getAttribute('aria-expanded')).toBe('true');
    expect(pencil('Morning Session').getAttribute('aria-expanded')).toBe('false');
  });

  it('opening another session\'s classes moves the editor to that session', async () => {
    await renderManager();
    fireEvent.click(rowButton('Morning Session'));
    await screen.findByRole('form', { name: 'Edit Morning Session' });
    fireEvent.click(rowButton('Evening Session'));
    expect(await screen.findByRole('form', { name: 'Edit Evening Session' })).toBeTruthy();
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
  });

  it('saving from the row button sends exactly what the editor always sent for a reorder', async () => {
    const { updateSession } = await renderManager();
    fireEvent.click(rowButton('Morning Session'));
    fireEvent.click(await screen.findByRole('button', { name: 'Move Grade 8 up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateSession).toHaveBeenCalledTimes(1));
    const [slug, patch] = updateSession.mock.calls[0];
    expect(slug).toBe('morning');
    // A reorder re-keys the subjects map in the new class order, as it did
    // before 001Fixes (phase13/classes.test.jsx pins the same pair of keys).
    expect(Object.keys(patch).sort()).toEqual(['classes', 'subjectsByClass']);
    expect(patch.classes).toEqual(['Grade 8', 'Grade 7', 'Grade 10', 'Form 3']);
    expect(Object.keys(patch.subjectsByClass)).toEqual(['Grade 8', 'Grade 7', 'Grade 10', 'Form 3']);
  });
});
