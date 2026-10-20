import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

/**
 * Per-session class lists: the teacher edits the classes a session's
 * registration form offers; the form shows exactly that list.
 */

beforeEach(() => vi.resetModules());
afterEach(() => cleanup());

const morning = {
  id: 'morning', name: 'Morning Session', active: true, description: '',
  schedule: null, icon: 'bi-sunrise-fill', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
};

describe('defaults agree between client and server', () => {
  it('DEFAULT_CLASSES and limits match api/_lib/sessions.js', async () => {
    const client = await import('@shared/constants/sessions');
    const server = await import('../../../api/_lib/sessions.js');
    expect([...client.DEFAULT_CLASSES]).toEqual([...server.DEFAULT_CLASSES]);
    expect(client.MAX_CLASSES).toBe(server.MAX_CLASSES);
    expect(client.MAX_CLASS_NAME).toBe(server.MAX_CLASS_NAME);
  });
});

describe('SessionEditor: classes students can choose', () => {
  async function renderEditor(session = morning) {
    const { default: SessionEditor } = await import('@/features/sessions/components/SessionEditor.jsx');
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SessionEditor session={session} onSave={onSave} onCancel={vi.fn()} />);
    return onSave;
  }
  const listValues = () => within(screen.getByTestId('class-list')).getAllByRole('textbox').map((i) => i.value);

  it('a session without its own list shows the defaults it has been offering', async () => {
    await renderEditor();
    expect(listValues()).toEqual(['Form One', 'Form Two', 'Form Three', 'Form Four']);
  });

  it('add, rename, remove and reorder — and only the changed list is saved', async () => {
    const onSave = await renderEditor();
    fireEvent.change(screen.getByLabelText('New class name'), { target: { value: '  Grade   7 ' } });
    fireEvent.keyDown(screen.getByLabelText('New class name'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Form Four' }));
    fireEvent.change(screen.getByLabelText('Class 1'), { target: { value: 'Form 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move Grade 7 up' }));
    expect(listValues()).toEqual(['Form 1', 'Form Two', 'Grade 7', 'Form Three']);

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toEqual({ classes: ['Form 1', 'Form Two', 'Grade 7', 'Form Three'] });
  });

  it('refuses a duplicate when adding (case-insensitive)', async () => {
    await renderEditor();
    fireEvent.change(screen.getByLabelText('New class name'), { target: { value: 'form two' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('"form two" is already in the list.');
    expect(listValues()).toHaveLength(4);
  });

  it('a blank class blocks saving with an explanation', async () => {
    const onSave = await renderEditor();
    fireEvent.change(screen.getByLabelText('Class 2'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/A class name cannot be blank/)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('the last class cannot be removed', async () => {
    await renderEditor({ ...morning, classes: ['Grade 7'] });
    expect(screen.getByRole('button', { name: 'Remove Grade 7' })).toBeDisabled();
  });

  it('a new session sends its classes on create', async () => {
    const { default: SessionEditor } = await import('@/features/sessions/components/SessionEditor.jsx');
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SessionEditor onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Saturday Class' } });
    fireEvent.click(screen.getByRole('button', { name: /Reset to defaults/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].classes).toEqual(['Form One', 'Form Two', 'Form Three', 'Form Four']);
  });
});

describe('RegistrationForm: the class dropdown is the session\'s list', () => {
  async function renderForm(props = {}) {
    const { default: RegistrationForm } = await import('@/features/registration/components/RegistrationForm.jsx');
    render(<RegistrationForm session="saturday" phoneNumber="+254711000001" onSubmit={vi.fn()} onBack={vi.fn()} loading={false} {...props} />);
    return [...screen.getByRole('combobox').querySelectorAll('option')].map((o) => o.textContent);
  }

  it('shows exactly the teacher\'s classes, in order', async () => {
    expect(await renderForm({ classes: ['Grade 7', 'Grade 8'] })).toEqual(['Select class...', 'Grade 7', 'Grade 8']);
  });

  it('falls back to the defaults when the session has no list', async () => {
    expect(await renderForm()).toEqual(['Select class...', 'Form One', 'Form Two', 'Form Three', 'Form Four']);
  });
});

describe('STK callback for local sandbox testing', () => {
  it('sandbox + localhost → public placeholder without the secret; live and public URLs are untouched', async () => {
    const { stkCallbackUrl } = await import('../../../api/_lib/daraja.js');
    const local = 'http://localhost:5173/api/daraja/callback/Ab3dEf6hIj9kLm2nOp5qRs';
    expect(stkCallbackUrl(local, { mode: 'dev' })).toEqual({ url: 'https://example.com/local-dev-callback', placeholder: true });
    expect(stkCallbackUrl('http://127.0.0.1:8787/api/daraja/callback/x', { mode: 'dev' }).placeholder).toBe(true);
    const tunnel = 'https://abc.trycloudflare.com/api/daraja/callback/Ab3dEf6hIj9kLm2nOp5qRs';
    expect(stkCallbackUrl(tunnel, { mode: 'dev' })).toEqual({ url: tunnel, placeholder: false });
    expect(stkCallbackUrl(local, { mode: 'live' })).toEqual({ url: local, placeholder: false });
  });
});
