import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { registrationSchema } from '../schemas/registrationSchema';

const CLASSES = ['Form One', 'Form Two', 'Form Three', 'Form Four'];

export default function RegistrationForm({
  session,
  phoneNumber,
  onSubmit,
  onBack,
  loading
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(registrationSchema),
    mode: 'onBlur',
  });

  return (
    <motion.div
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
            {CLASSES.map((cls) => (
              <option key={cls} value={cls}>{cls}</option>
            ))}
          </select>
          {errors.class && (
            <div className="invalid-feedback">{errors.class.message}</div>
          )}
        </div>

        {/* Subjects */}
        <div className="mb-3">
          <label className="form-label fw-semibold">
            Subjects Enrolled <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            className={`form-control ${errors.subjects ? 'is-invalid' : ''}`}
            placeholder="e.g., Mathematics, Physics, Chemistry, Biology"
            {...register('subjects')}
          />
          <div className="form-text">Enter subjects separated by commas</div>
          {errors.subjects && (
            <div className="invalid-feedback">{errors.subjects.message}</div>
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
    </motion.div>
  );
}
