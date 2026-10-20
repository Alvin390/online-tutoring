import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { m } from 'framer-motion';
import { registrationSchema } from '../schemas/registrationSchema';
import { DEFAULT_CLASSES } from '@shared/constants/sessions';
import { subjectsForClass } from '@shared/constants/subjects';
import SubjectPicker, { compulsoryNames } from './SubjectPicker';

export default function RegistrationForm({
  session,
  phoneNumber,
  onSubmit,
  onBack,
  loading,
  // The session's own class list (edited by the teacher); defaults otherwise.
  classes = DEFAULT_CLASSES,
  // Phase 14: each class's subjects, resolved by the server (bootstrap).
  subjectsByClass = null,
}) {
  const classOptions = Array.isArray(classes) && classes.length > 0 ? classes : DEFAULT_CLASSES;
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(registrationSchema),
    mode: 'onBlur',
    defaultValues: { subjects: '' },
  });

  const selectedClass = watch('class');
  const picked = watch('subjects');
  // The bootstrap's list for the class; the defaults by name if it is missing
  // (a page cached from before subjects existed).
  const subjectOptions = selectedClass
    ? (subjectsByClass?.[selectedClass] ?? subjectsForClass(null, selectedClass))
    : [];
  const usePicker = subjectOptions.length > 0;

  // A new class starts from its compulsory subjects (or an empty text box).
  useEffect(() => {
    if (!selectedClass) return;
    const options = subjectsByClass?.[selectedClass] ?? subjectsForClass(null, selectedClass);
    const start = options.length > 0 ? compulsoryNames(options) : '';
    // Validate straight away only when something is already ticked (Form 3):
    // the submit button must enable without another click, but an empty
    // choice should not show an error before the student has done anything.
    setValue('subjects', start, { shouldValidate: start.length > 0 });
  }, [selectedClass, subjectsByClass, setValue]);

  return (
    <m.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="glass-card"
    >
      <div className="text-center mb-4">
        <div className={`session-badge ${session}-badge mb-3`}>
          <i className={`bi bi-${session === 'morning' ? 'sunrise' : 'moon-stars'}-fill me-2`} />
          {session.charAt(0).toUpperCase() + session.slice(1)} Session
        </div>
        <h4 className="fw-bold">Complete Your Registration</h4>
        <p className="text-muted">Fill in your details to join the class</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        {/* Phone Number (Read-only) */}
        <div className="mb-3">
          <label className="form-label fw-semibold">Parent's Phone Number</label>
          <input
            type="tel"
            className="form-control"
            value={phoneNumber}
            disabled
          />
          <div className="form-text text-success">
            <i className="bi bi-check-circle-fill" /> Verified
          </div>
        </div>

        {/* Student Name */}
        <div className="mb-3">
          <label className="form-label fw-semibold">
            Student's Full Name <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            className={`form-control ${errors.studentName ? 'is-invalid' : ''}`}
            placeholder="e.g., John Kamau Doe"
            {...register('studentName')}
          />
          {errors.studentName && (
            <div className="invalid-feedback">{errors.studentName.message}</div>
          )}
        </div>

        {/* Class */}
        <div className="mb-3">
          <label className="form-label fw-semibold">
            Class/Form <span className="text-danger">*</span>
          </label>
          <select
            className={`form-select ${errors.class ? 'is-invalid' : ''}`}
            {...register('class')}
          >
            <option value="">Select class...</option>
            {classOptions.map((cls) => (
              <option key={cls} value={cls}>{cls}</option>
            ))}
          </select>
          {errors.class && (
            <div className="invalid-feedback">{errors.class.message}</div>
          )}
        </div>

        {/* Subjects — checkboxes for the chosen class (Phase 14), or free
            text for a class without a subject list. */}
        <div className="mb-3">
          <label className="form-label fw-semibold" id="reg-subjects-label">
            Subjects Enrolled <span className="text-danger">*</span>
          </label>
          {!selectedClass && (
            <div className="form-text mt-0">Choose a class to see its subjects.</div>
          )}
          {selectedClass && usePicker && (
            <>
              <SubjectPicker
                options={subjectOptions}
                value={Array.isArray(picked) ? picked : []}
                onChange={(names) => setValue('subjects', names, { shouldValidate: true, shouldDirty: true })}
                invalid={Boolean(errors.subjects)}
                describedBy="reg-subjects-label"
                legend={`Subjects for ${selectedClass}`}
              />
              <div className="form-text">Tick every subject the student will take.</div>
            </>
          )}
          {selectedClass && !usePicker && (
            <>
              <input
                type="text"
                className={`form-control ${errors.subjects ? 'is-invalid' : ''}`}
                placeholder="e.g., Mathematics, Physics, Chemistry, Biology"
                aria-labelledby="reg-subjects-label"
                {...register('subjects')}
              />
              <div className="form-text">Enter subjects separated by commas</div>
            </>
          )}
          {errors.subjects && (
            <div className="invalid-feedback d-block">{errors.subjects.message}</div>
          )}
        </div>

        {/* Payment Receipt */}
        <div className="mb-4">
          <label className="form-label fw-semibold">
            Payment Receipt/Details <span className="text-danger">*</span>
          </label>
          <textarea
            className={`form-control ${errors.receiptMessage ? 'is-invalid' : ''}`}
            rows="3"
            placeholder={`Example:\nM-Pesa Transaction Code: XYZ123456\nAmount Paid: KES 5,000\nPayment Date: October 20, 2025`}
            {...register('receiptMessage')}
          />
          <div className="form-text">
            Provide payment method, reference number, amount, and date
          </div>
          {errors.receiptMessage && (
            <div className="invalid-feedback">{errors.receiptMessage.message}</div>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          className="btn btn-primary btn-lg w-100 mb-2"
          disabled={loading || !isValid}
        >
          {loading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Registering...
            </>
          ) : (
            <>
              Register & Join Class
              <i className="bi bi-box-arrow-in-right ms-2" />
            </>
          )}
        </button>

        {/* Back Button */}
        <button
          type="button"
          className="btn btn-outline-secondary w-100"
          onClick={onBack}
          disabled={loading}
        >
          <i className="bi bi-arrow-left me-2" />
          Use different phone number
        </button>
      </form>
    </m.div>
  );
}
