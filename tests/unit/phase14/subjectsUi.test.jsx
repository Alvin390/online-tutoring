import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';

/**
 * Phase 14 — subjects per class (UI): the registration form's checkboxes, the
 * resubmit screen, the teacher's edit-student modal and the session editor.
 */

const MOCKED = ['@shared/config/FlagsContext', '@features/auth/context/AuthContext', '@services/api/fees'];
beforeEach(() => vi.resetModules());
afterEach(() => {
  cleanup();
  for (const id of MOCKED) vi.doUnmock(id);
});

const FORM3 = [
  { name: 'English', compulsory: true },
  { name: 'Kiswahili', compulsory: true },
  { name: 'Mathematics', compulsory: true },
];
const GRADE10 = [
  { name: 'English', compulsory: false },
  { name: 'Kiswahili', compulsory: false },
  { name: 'Mathematics', compulsory: false },
  { name: 'Community Service Learning (CSL)', compulsory: false },
];

const boxes = () => within(screen.getByTestId('subject-picker')).getAllByRole('checkbox');
const labelOf = (box) => document.querySelector(`label[for="${box.id}"]`).textContent;

// ---------------------------------------------------------------------------
describe('SubjectPicker', () => {
  async function renderPicker(props) {
    const { default: SubjectPicker } = await import('@/features/registration/components/SubjectPicker.jsx');
    const onChange = vi.fn();
    render(<SubjectPicker onChange={onChange} {...props} />);
    return onChange;
  }

  it('compulsory subjects are ticked, locked and labelled', async () => {
    await renderPicker({ options: FORM3, value: [] });
    for (const box of boxes()) {
      expect(box.checked).toBe(true);
      expect(box.disabled).toBe(true);
      expect(labelOf(box)).toMatch(/Compulsory/);
    }
  });

  it('ticking keeps the list\'s order; a name not on the list is an extra, ticked box', async () => {
    const onChange = await renderPicker({ options: GRADE10, value: ['Mathematics', 'Physics'] });
    expect(boxes().map(labelOf)).toEqual(['English', 'Kiswahili', 'Mathematics', 'Community Service Learning (CSL)',
      "Physics (not on this class's list)"]);
    fireEvent.click(screen.getByLabelText('English'));
    expect(onChange).toHaveBeenLastCalledWith(['English', 'Mathematics', 'Physics']);
    fireEvent.click(screen.getByLabelText(/Physics/));
    expect(onChange).toHaveBeenLastCalledWith(['Mathematics']);
  });

  it('lockCompulsory off (teacher): a compulsory subject can be unticked', async () => {
    const onChange = await renderPicker({ options: FORM3, value: ['English', 'Kiswahili', 'Mathematics'], lockCompulsory: false });
    expect(boxes().every((b) => !b.disabled)).toBe(true);
    fireEvent.click(screen.getByLabelText(/Kiswahili/));
    expect(onChange).toHaveBeenLastCalledWith(['English', 'Mathematics']);
  });
});

// ---------------------------------------------------------------------------
describe('RegistrationForm: subjects follow the class', () => {
  const SUBJECTS = { 'Grade 10': GRADE10, 'Form 3': FORM3, 'Adult Class': [] };
  async function renderForm() {
    const { default: RegistrationForm } = await import('@/features/registration/components/RegistrationForm.jsx');
    const onSubmit = vi.fn();
    render(<RegistrationForm session="morning" phoneNumber="+254711000001" onSubmit={onSubmit} onBack={vi.fn()}
      loading={false} classes={['Grade 10', 'Form 3', 'Adult Class']} subjectsByClass={SUBJECTS} />);
    fireEvent.change(screen.getByPlaceholderText(/John Kamau/), { target: { value: 'Amina Wanjiru' } });
    fireEvent.blur(screen.getByPlaceholderText(/John Kamau/));
    fireEvent.change(document.querySelector('textarea'), { target: { value: 'QAB123XYZ9 Confirmed KES 1,000' } });
    fireEvent.blur(document.querySelector('textarea'));
    return onSubmit;
  }
  const pickClass = (cls) => act(async () => {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: cls } });
  });
  const submit = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: /Register & Join Class/ })); });

  it('does not repeat the session badge the page already shows', async () => {
    await renderForm();
    expect(screen.queryByText(/Morning Session/)).toBeNull();
    expect(document.querySelector('.session-badge')).toBeNull();
  });

  it('no class yet: a prompt, no checkboxes', async () => {
    await renderForm();
    expect(screen.getByText('Choose a class to see its subjects.')).toBeTruthy();
    expect(screen.queryByTestId('subject-picker')).toBeNull();
  });

  it('Grade 10: its four subjects, none ticked; nothing ticked cannot be submitted', async () => {
    const onSubmit = await renderForm();
    await pickClass('Grade 10');
    expect(boxes().map(labelOf)).toEqual(GRADE10.map((s) => s.name));
    expect(boxes().every((b) => !b.checked)).toBe(true);
    expect(screen.getByRole('button', { name: /Register & Join Class/ }).disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByLabelText('Community Service Learning (CSL)')); });
    await act(async () => { fireEvent.click(screen.getByLabelText('English')); });
    await waitFor(() => expect(screen.getByRole('button', { name: /Register & Join Class/ }).disabled).toBe(false));
    await submit();
    expect(onSubmit).toHaveBeenCalled();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ class: 'Grade 10', subjects: ['English', 'Community Service Learning (CSL)'] });
  });

  it('Form 3: English, Kiswahili and Mathematics come ticked and locked', async () => {
    const onSubmit = await renderForm();
    await pickClass('Form 3');
    expect(boxes().every((b) => b.checked && b.disabled)).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: /Register & Join Class/ }).disabled).toBe(false));
    await submit();
    expect(onSubmit.mock.calls[0][0].subjects).toEqual(['English', 'Kiswahili', 'Mathematics']);
  });

  it('switching class starts again from the new class\'s compulsory subjects', async () => {
    await renderForm();
    await pickClass('Grade 10');
    await act(async () => { fireEvent.click(screen.getByLabelText('English')); });
    await pickClass('Form 3');
    expect(boxes().map((b) => b.checked)).toEqual([true, true, true]);
    await pickClass('Grade 10');
    expect(boxes().every((b) => !b.checked)).toBe(true);
  });

  it('a class without a subject list keeps the free-text box', async () => {
    const onSubmit = await renderForm();
    await pickClass('Adult Class');
    expect(screen.queryByTestId('subject-picker')).toBeNull();
    const text = screen.getByPlaceholderText(/Mathematics, Physics/);
    await act(async () => { fireEvent.change(text, { target: { value: 'Bookkeeping' } }); fireEvent.blur(text); });
    await waitFor(() => expect(screen.getByRole('button', { name: /Register & Join Class/ }).disabled).toBe(false));
    await submit();
    expect(onSubmit.mock.calls[0][0].subjects).toBe('Bookkeeping');
  });
});

// ---------------------------------------------------------------------------
describe('RejectedScreen: resubmit uses the same checkboxes', () => {
  it('pre-ticks what they registered with; changing class resets; sends the list', async () => {
    const { default: RejectedScreen } = await import('@/features/registration/components/RejectedScreen.jsx');
    const onResubmit = vi.fn().mockResolvedValue({ success: true });
    render(<RejectedScreen
      studentData={{ studentName: 'Amina Wanjiru', class: 'Grade 10', subjects: 'English, Mathematics', rejectionReason: 'Wrong receipt' }}
      classes={['Grade 10', 'Form 3']} subjectsByClass={{ 'Grade 10': GRADE10, 'Form 3': FORM3 }}
      onResubmit={onResubmit} onBack={vi.fn()} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Correct and resubmit/ }));
    expect(boxes().filter((b) => b.checked).map(labelOf)).toEqual(['English', 'Mathematics']);

    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'Form 3' } });
    expect(boxes().map((b) => b.checked)).toEqual([true, true, true]);

    fireEvent.change(screen.getByLabelText('Payment confirmation message'), { target: { value: 'QAB123XYZ9 Confirmed KES 1,000' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send for review' })); });
    expect(onResubmit).toHaveBeenCalledWith(expect.objectContaining({ class: 'Form 3', subjects: ['English', 'Kiswahili', 'Mathematics'] }));
  });
});

// ---------------------------------------------------------------------------
describe("teacher's edit student: checkboxes for the student's class", () => {
  async function renderTable(student, sessionDoc) {
    vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));
    vi.doMock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));
    vi.doMock('@services/api/fees', () => ({ postLedgerEntry: vi.fn() }));
    const { default: StudentTable } = await import('@/features/dashboard/components/StudentTable.jsx');
    const onEdit = vi.fn().mockResolvedValue({ success: true });
    render(<StudentTable session="morning" sessionDoc={sessionDoc} students={[student]} loading={false} onDelete={vi.fn()}
      onEdit={onEdit} onView={vi.fn()} onExport={vi.fn()} onBlock={vi.fn()} onUnblock={vi.fn()} onApprove={vi.fn()} onDecline={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Edit student'));
    return onEdit;
  }
  const base = { id: '+254711000001', studentName: 'Amina', parentPhone: '+254711000001', receiptMessage: 'QAB123XYZ9 Confirmed' };

  it('shows the class\'s subjects (defaults by name) with the current ones ticked, and saves the text', async () => {
    const onEdit = await renderTable({ ...base, class: 'Grade 10', subjects: 'English, Physics' }, { id: 'morning', classes: ['Grade 10'] });
    expect(boxes().map(labelOf)).toEqual([...GRADE10.map((s) => s.name), "Physics (not on this class's list)"]);
    expect(boxes().filter((b) => b.checked).map(labelOf)).toEqual(['English', "Physics (not on this class's list)"]);
    fireEvent.click(screen.getByLabelText('Kiswahili'));
    fireEvent.click(screen.getByLabelText(/Physics/));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
    expect(onEdit).toHaveBeenCalled();
    expect(onEdit.mock.calls[0][2].subjects).toBe('English, Kiswahili');
  });

  it('uses the session\'s own list for the class', async () => {
    await renderTable({ ...base, class: 'Form 3', subjects: 'English' },
      { id: 'morning', classes: ['Form 3'], subjectsByClass: { 'Form 3': [{ name: 'English', compulsory: true }, { name: 'Biology' }] } });
    expect(boxes().map(labelOf)).toEqual(['EnglishCompulsory', 'Biology']);
  });

  it('a class without a list keeps the text box', async () => {
    await renderTable({ ...base, class: 'Adult Class', subjects: 'Typing' }, { id: 'morning', classes: ['Adult Class'] });
    expect(screen.queryByTestId('subject-picker')).toBeNull();
    expect(screen.getByDisplayValue('Typing')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('session editor: subjects per class', () => {
  const morning = {
    id: 'morning', name: 'Morning Session', active: true, description: '', schedule: null,
    icon: 'bi-sunrise-fill', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    classes: ['Grade 7', 'Grade 8', 'Grade 10', 'Form 3'],
  };
  async function renderEditor(session = morning) {
    const { default: SessionEditor } = await import('@/features/sessions/components/SessionEditor.jsx');
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SessionEditor session={session} onSave={onSave} onCancel={vi.fn()} />);
    return onSave;
  }
  const save = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });

  it('each class shows its subject count; opening Form 3 shows its three compulsory subjects', async () => {
    await renderEditor();
    const toggles = screen.getAllByRole('button', { name: /Show subjects for/ });
    expect(toggles.map((b) => b.textContent.trim())).toEqual(['9', '9', '4', '3']);
    fireEvent.click(screen.getByRole('button', { name: 'Show subjects for Form 3' }));
    const panel = screen.getByTestId('subjects-3');
    expect(within(panel).getAllByRole('textbox').slice(0, 3).map((i) => i.value)).toEqual(['English', 'Kiswahili', 'Mathematics']);
    expect(within(panel).getAllByRole('checkbox').every((c) => c.checked)).toBe(true);
  });

  it('nothing changed: nothing is sent (the defaults are not written just by opening the editor)', async () => {
    const onSave = await renderEditor();
    await save();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('add a subject, mark it compulsory, rename the class: saved under the new name', async () => {
    const onSave = await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Show subjects for Form 3' }));
    const add = screen.getByLabelText('New subject for Form 3');
    fireEvent.change(add, { target: { value: 'Biology' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    fireEvent.click(screen.getByLabelText(/Compulsory \(Biology\)/));
    fireEvent.change(screen.getByLabelText('Class 4'), { target: { value: 'Form Three' } });
    await save();
    expect(onSave).toHaveBeenCalled();
    const patch = onSave.mock.calls[0][0];
    expect(patch.classes).toEqual(['Grade 7', 'Grade 8', 'Grade 10', 'Form Three']);
    expect(patch.subjectsByClass['Form Three']).toEqual([...FORM3, { name: 'Biology', compulsory: true }]);
    expect(patch.subjectsByClass['Grade 10'].map((s) => s.name)).toContain('Community Service Learning (CSL)');
  });

  it('a duplicate subject is refused when adding; a blank one blocks saving', async () => {
    const onSave = await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Show subjects for Grade 10' }));
    fireEvent.change(screen.getByLabelText('New subject for Grade 10'), { target: { value: 'english' } });
    fireEvent.click(screen.getByRole('button', { name: /Add subject/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('"english" is already a subject for Grade 10.');
    fireEvent.change(screen.getByLabelText('Grade 10 subject 2'), { target: { value: '  ' } });
    await save();
    expect(await screen.findByText(/A subject name in Grade 10 is blank/)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('remove every subject of a class: students type theirs instead (saved as an empty list)', async () => {
    const onSave = await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Show subjects for Grade 10' }));
    for (const name of ['English', 'Kiswahili', 'Mathematics', 'Community Service Learning (CSL)']) {
      fireEvent.click(screen.getByRole('button', { name: `Remove ${name}` }));
    }
    expect(screen.getByText(/students in this class type their subjects instead/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Use the default subjects for Grade 10/ }));
    expect(within(screen.getByTestId('subjects-2')).getAllByRole('textbox')).toHaveLength(5); // 4 + the add box
    for (const name of ['English', 'Kiswahili', 'Mathematics', 'Community Service Learning (CSL)']) {
      fireEvent.click(screen.getByRole('button', { name: `Remove ${name}` }));
    }
    await save();
    expect(onSave.mock.calls[0][0].subjectsByClass['Grade 10']).toEqual([]);
  });

  it('a new class with a known name starts with its defaults; an unknown one with none', async () => {
    const onSave = await renderEditor({ ...morning, classes: ['Form 3'] });
    for (const cls of ['Grade 8', 'Adult Class']) {
      fireEvent.change(screen.getByLabelText('New class name'), { target: { value: cls } });
      fireEvent.keyDown(screen.getByLabelText('New class name'), { key: 'Enter' });
    }
    await save();
    const map = onSave.mock.calls[0][0].subjectsByClass;
    expect(map['Grade 8']).toHaveLength(9);
    expect(map['Adult Class']).toEqual([]);
  });
});
