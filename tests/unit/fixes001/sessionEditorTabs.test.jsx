import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import SessionEditor from '@/features/sessions/components/SessionEditor.jsx';

/**
 * 001Fixes / 01 — the session editor gets two tabs, "Details" and
 * "Classes & subjects", so the class editor is no longer buried between the
 * colour swatches and the homepage switch. One form, one Save: the payload is
 * exactly what it was before the tabs existed.
 */

afterEach(() => cleanup());

const morning = {
  id: 'morning', name: 'Morning Session', active: true, description: '',
  schedule: { days: [], startTime: '08:00', endTime: '12:00', tz: 'Africa/Nairobi' },
  icon: 'bi-sunrise-fill', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  classes: ['Grade 7', 'Grade 8', 'Grade 10', 'Form 3'],
};

function renderEditor(props = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(<SessionEditor session={morning} onSave={onSave} onCancel={onCancel} {...props} />);
  return { onSave, onCancel };
}

const detailsTab = () => screen.getByRole('tab', { name: /Details/ });
const classesTab = () => screen.getByRole('tab', { name: /Classes & subjects/ });
const classesPanel = () => document.getElementById(classesTab().getAttribute('aria-controls'));
const detailsPanel = () => document.getElementById(detailsTab().getAttribute('aria-controls'));
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

describe('two tabs', () => {
  it('a tablist with Details selected by default, each tab controlling its panel', () => {
    renderEditor();
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(detailsTab().getAttribute('aria-selected')).toBe('true');
    expect(classesTab().getAttribute('aria-selected')).toBe('false');
    expect(detailsPanel().getAttribute('role')).toBe('tabpanel');
    expect(detailsPanel().hidden).toBe(false);
    expect(classesPanel().hidden).toBe(true);
    // The session-name field lives on Details, the class list on Classes.
    expect(within(detailsPanel()).getByLabelText('Session name')).toBeTruthy();
    expect(within(classesPanel()).getByTestId('class-list')).toBeTruthy();
  });

  it('the Classes tab shows how many classes the session has', () => {
    renderEditor();
    expect(within(classesTab()).getByTestId('class-count').textContent).toBe('4');
  });

  it('clicking a tab switches panels', () => {
    renderEditor();
    fireEvent.click(classesTab());
    expect(classesTab().getAttribute('aria-selected')).toBe('true');
    expect(classesPanel().hidden).toBe(false);
    expect(detailsPanel().hidden).toBe(true);
  });

  it('arrow keys move between tabs', () => {
    renderEditor();
    fireEvent.keyDown(detailsTab(), { key: 'ArrowRight' });
    expect(classesTab().getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(classesTab());
    fireEvent.keyDown(classesTab(), { key: 'ArrowLeft' });
    expect(detailsTab().getAttribute('aria-selected')).toBe('true');
  });

  it('initialView="classes" opens on the Classes tab', () => {
    renderEditor({ initialView: 'classes' });
    expect(classesTab().getAttribute('aria-selected')).toBe('true');
    expect(classesPanel().hidden).toBe(false);
  });

  it('a new session gets the same two tabs, with the default classes', () => {
    render(<SessionEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(detailsTab()).toBeTruthy();
    expect(within(classesTab()).getByTestId('class-count').textContent).toBe('4');
  });
});

describe('one form across both tabs', () => {
  it('edits on both tabs survive switching and go out in ONE save, as before', async () => {
    const { onSave } = renderEditor();
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Early Birds' } });
    fireEvent.click(classesTab());
    fireEvent.change(screen.getByLabelText('New class name'), { target: { value: 'Grade 9' } });
    fireEvent.keyDown(screen.getByLabelText('New class name'), { key: 'Enter' });
    fireEvent.click(detailsTab());
    expect(screen.getByLabelText('Session name').value).toBe('Early Birds');
    fireEvent.click(classesTab());
    expect(within(screen.getByTestId('class-list')).getAllByRole('textbox').map((i) => i.value))
      .toEqual(['Grade 7', 'Grade 8', 'Grade 10', 'Form 3', 'Grade 9']);
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(Object.keys(onSave.mock.calls[0][0]).sort()).toEqual(['classes', 'name', 'subjectsByClass']);
    expect(onSave.mock.calls[0][0].name).toBe('Early Birds');
    expect(onSave.mock.calls[0][0].classes).toEqual(['Grade 7', 'Grade 8', 'Grade 10', 'Form 3', 'Grade 9']);
  });

  it('nothing changed: nothing is sent (Cancel), whichever tab is open', () => {
    const { onSave, onCancel } = renderEditor({ initialView: 'classes' });
    save();
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('errors on the tab you are not looking at', () => {
  it('a blank class, saved from Details, switches to Classes and shows why', () => {
    const { onSave } = renderEditor();
    fireEvent.click(classesTab());
    fireEvent.change(screen.getByLabelText('Class 2'), { target: { value: '   ' } });
    fireEvent.click(detailsTab());
    save();
    expect(onSave).not.toHaveBeenCalled();
    expect(classesTab().getAttribute('aria-selected')).toBe('true');
    expect(within(classesPanel()).getByText(/A class name cannot be blank/)).toBeTruthy();
    expect(within(classesTab()).getByTestId('tab-error')).toBeTruthy();
  });

  it('a blank name, saved from Classes, switches to Details', () => {
    const { onSave } = renderEditor({ initialView: 'classes' });
    fireEvent.click(detailsTab());
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: '' } });
    fireEvent.click(classesTab());
    save();
    expect(onSave).not.toHaveBeenCalled();
    expect(detailsTab().getAttribute('aria-selected')).toBe('true');
    expect(within(detailsTab()).getByTestId('tab-error')).toBeTruthy();
  });

  it('stays put when the open tab has an error of its own', () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: '' } });
    fireEvent.click(classesTab());
    fireEvent.change(screen.getByLabelText('Class 2'), { target: { value: '' } });
    save();
    expect(classesTab().getAttribute('aria-selected')).toBe('true');
    // Both tabs flag their errors.
    expect(within(detailsTab()).getByTestId('tab-error')).toBeTruthy();
    expect(within(classesTab()).getByTestId('tab-error')).toBeTruthy();
  });

  it('no error dots before the first Save attempt', () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: '' } });
    expect(screen.queryAllByTestId('tab-error')).toHaveLength(0);
  });
});

describe('unsaved changes', () => {
  it('no pill on open; a pill after an edit on either tab; gone when the edit is undone', () => {
    renderEditor();
    expect(screen.queryByTestId('unsaved-pill')).toBeNull();
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Early Birds' } });
    expect(screen.getByTestId('unsaved-pill').textContent).toMatch(/Unsaved changes/);
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Morning Session' } });
    expect(screen.queryByTestId('unsaved-pill')).toBeNull();

    fireEvent.click(classesTab());
    fireEvent.click(screen.getByRole('button', { name: 'Move Grade 8 up' }));
    expect(screen.getByTestId('unsaved-pill')).toBeTruthy();
  });
});
