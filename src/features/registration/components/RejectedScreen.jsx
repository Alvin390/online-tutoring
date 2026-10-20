import { useState } from 'react';
import { m } from 'framer-motion';
import { DEFAULT_CLASSES } from '@shared/constants/sessions';
import { subjectsForClass, parseSubjects } from '@shared/constants/subjects';
import SubjectPicker, { compulsoryNames } from './SubjectPicker';

/**
 * Shown to a student whose registration was rejected — Phase 04 Part A.
 *
 * The teacher's reason is always displayed. A rejection with no reason is
 * unactionable, which is why the API requires one of at least 10 characters.
 *
 * The resubmit form pre-fills with what they originally submitted, so a student
 * correcting one field does not retype everything. Server-side, three
 * rejections trigger a 24-hour soft block; when that fires, the API returns
 * `resubmit_blocked` and this screen shows the wait time instead of the form.
 */
export default function RejectedScreen({
  studentData, onResubmit, onBack, loading, classes = DEFAULT_CLASSES, subjectsByClass = null,
}) {
  const [showForm, setShowForm] = useState(false);
  const optionsFor = (cls) => subjectsByClass?.[cls] ?? subjectsForClass(null, cls);
  const initialClass = studentData?.class ?? '';
  const [form, setForm] = useState({
    studentName: studentData?.studentName ?? '',
    class: initialClass,
    // Phase 14: a list when the class has subjects (checkboxes), else text.
    subjects: optionsFor(initialClass).length > 0
      ? parseSubjects(studentData?.subjects ?? '')
      : studentData?.subjects ?? '',
    receiptMessage: '',
  });
  const [error, setError] = useState('');
  // The class's current list, plus the one they registered with if the
  // teacher has since removed it, so the dropdown never drops their value.
  const classChoices = [...new Set([...(classes?.length ? classes : DEFAULT_CLASSES), ...(initialClass ? [initialClass] : [])])];
  const subjectOptions = optionsFor(form.class);

  const changeClass = (cls) => {
    const options = optionsFor(cls);
    setForm({ ...form, class: cls, subjects: options.length > 0 ? compulsoryNames(options) : '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.receiptMessage.trim().length < 10) {
      setError('Please paste your full payment confirmation message.');
      return;
    }
    if (Array.isArray(form.subjects) ? form.subjects.length === 0 : form.subjects.trim().length < 3) {
      setError('Please choose at least one subject.');
      return;
    }

    const result = await onResubmit(form);
    if (!result?.success) setError(result?.message ?? 'Could not resubmit. Please try again.');
  };

  return (
    <m.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card"
    >
      <div className="py-4">
        <div className="text-center mb-4">
          <div
            style={{
              width: '5rem',
              height: '5rem',
              background: 'rgba(220, 53, 69, 0.1)',
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.5rem',
              color: '#dc3545',
            }}
          >
            <i className="bi bi-exclamation-circle" aria-hidden="true" />
          </div>
          <h3 className="fw-bold mt-3 mb-2">Your registration needs another look</h3>
        </div>

        {/* The teacher's reason. This is the whole point of the screen. */}
        <div className="alert alert-warning" role="alert">
          <strong className="d-block mb-1">Your teacher said:</strong>
          {studentData?.rejectionReason || 'No reason was given. Please contact your teacher.'}
        </div>

        {!showForm ? (
          <>
            <p className="text-muted small">
              Fix whatever is mentioned above and send it again. Your details are
              saved, so you only need to change what&apos;s wrong.
            </p>
            <button className="btn btn-primary btn-lg w-100 mb-3" onClick={() => setShowForm(true)}>
              <i className="bi bi-pencil-square me-2" aria-hidden="true" />
              Correct and resubmit
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="mb-3">
            <div className="mb-3">
              <label className="form-label fw-semibold" htmlFor="rs-name">Student name</label>
              <input
                id="rs-name"
                className="form-control"
                value={form.studentName}
                onChange={(e) => setForm({ ...form, studentName: e.target.value })}
                required
                minLength={2}
                maxLength={100}
              />
            </div>

            <div className="mb-3">
              <label className="form-label fw-semibold" htmlFor="rs-class">Class</label>
              <select
                id="rs-class"
                className="form-select"
                value={form.class}
                onChange={(e) => changeClass(e.target.value)}
                required
              >
                <option value="">Select class...</option>
                {classChoices.map((cls) => <option key={cls} value={cls}>{cls}</option>)}
              </select>
            </div>

            <div className="mb-3">
              <label className="form-label fw-semibold" htmlFor="rs-subjects" id="rs-subjects-label">Subjects</label>
              {subjectOptions.length > 0 ? (
                <SubjectPicker
                  options={subjectOptions}
                  value={Array.isArray(form.subjects) ? form.subjects : parseSubjects(form.subjects)}
                  onChange={(names) => setForm({ ...form, subjects: names })}
                  describedBy="rs-subjects-label"
                  legend={`Subjects for ${form.class}`}
                />
              ) : (
                <input
                  id="rs-subjects"
                  className="form-control"
                  value={Array.isArray(form.subjects) ? form.subjects.join(', ') : form.subjects}
                  onChange={(e) => setForm({ ...form, subjects: e.target.value })}
                  required
                  minLength={3}
                  maxLength={500}
                />
              )}
            </div>

            <div className="mb-3">
              <label className="form-label fw-semibold" htmlFor="rs-receipt">
                Payment confirmation message
              </label>
              <textarea
                id="rs-receipt"
                className="form-control"
                rows={4}
                placeholder="Paste the full M-Pesa confirmation message here"
                value={form.receiptMessage}
                onChange={(e) => setForm({ ...form, receiptMessage: e.target.value })}
                required
                minLength={10}
                maxLength={500}
              />
              <div className="form-text">{form.receiptMessage.length}/500</div>
            </div>

            {error && (
              <div className="alert alert-danger" role="alert" aria-live="assertive">
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg w-100" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Sending…
                </>
              ) : (
                'Send for review'
              )}
            </button>
          </form>
        )}

        <div className="text-center">
          <button className="btn btn-link" onClick={onBack}>
            <i className="bi bi-arrow-left me-1" aria-hidden="true" />
            Use a different number
          </button>
        </div>
      </div>
    </m.div>
  );
}
