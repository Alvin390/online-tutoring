# Phase 4-5: Component Development
## Complete React Component Transformation Guide

---

## **PHASE 4: Registration Feature Components** (Day 2-3, 6-8 hours)

### 4.1 Registration Schemas (Zod Validation)

**File: `src/features/registration/schemas/registrationSchema.js`**
```javascript
import { z } from 'zod';

export const phoneCheckSchema = z.object({
  country: z.string().min(2, 'Please select a country'),
  phoneNumber: z.string().min(8, 'Phone number is required'),
});

export const registrationSchema = z.object({
  studentName: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name is too long')
    .regex(/^[a-zA-Z\s]+$/, 'Name can only contain letters and spaces'),

  class: z
    .string()
    .min(1, 'Please select a class'),

  subjects: z
    .string()
    .min(3, 'Please enter at least one subject')
    .max(200, 'Subjects list is too long'),

  receiptMessage: z
    .string()
    .min(10, 'Please provide detailed payment information')
    .max(500, 'Payment details are too long'),
});
```

### 4.2 Phone Validation Hook

**File: `src/features/registration/hooks/usePhoneValidation.js`**
```javascript
import { useState, useCallback } from 'react';
import { validatePhoneNumber } from '@/shared/constants/countries';

export const usePhoneValidation = () => {
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isValid, setIsValid] = useState(false);

  const handleCountryChange = useCallback((country) => {
    setSelectedCountry(country);
    setPhoneNumber('');
    setIsValid(false);
  }, []);

  const handlePhoneChange = useCallback((value) => {
    if (!selectedCountry) return;

    // Remove non-digits
    const cleaned = value.replace(/\D/g, '');

    // Limit to country length
    const limited = cleaned.slice(0, selectedCountry.length);
    setPhoneNumber(limited);

    // Validate
    const valid = validatePhoneNumber(selectedCountry, limited);
    setIsValid(valid);
  }, [selectedCountry]);

  const getFullPhoneNumber = useCallback(() => {
    if (!selectedCountry || !phoneNumber) return '';
    return `${selectedCountry.dial}${phoneNumber}`;
  }, [selectedCountry, phoneNumber]);

  return {
    selectedCountry,
    phoneNumber,
    isValid,
    handleCountryChange,
    handlePhoneChange,
    getFullPhoneNumber,
  };
};
```

### 4.3 Registration Hook

**File: `src/features/registration/hooks/useRegistration.js`**
```javascript
import { useState, useCallback } from 'react';
import {
  checkStudentExists,
  registerStudent,
  updateLastAccessed,
  getZoomLinks,
} from '@services/firebase/firestore';
import { useToast } from '@/context/ToastContext';
import { logInfo, logError } from '@utils/logger';
import { trackRegistration, trackZoomRedirect } from '@utils/analytics';

export const useRegistration = (session) => {
  const [loading, setLoading] = useState(false);
  const [studentData, setStudentData] = useState(null);
  const [isReturningStudent, setIsReturningStudent] = useState(false);
  const { showError, showSuccess } = useToast();

  const checkStudent = useCallback(async (phoneNumber) => {
    setLoading(true);
    try {
      const { exists, data } = await checkStudentExists(session, phoneNumber);

      if (exists) {
        setStudentData(data);
        setIsReturningStudent(true);
        await updateLastAccessed(session, phoneNumber);
      } else {
        setIsReturningStudent(false);
      }

      return { exists, data };
    } catch (error) {
      logError('Check student failed', error);
      showError('Unable to check registration. Please try again.');
      throw error;
    } finally {
      setLoading(false);
    }
  }, [session, showError]);

  const register = useCallback(async (phoneNumber, formData) => {
    setLoading(true);
    try {
      await registerStudent(session, phoneNumber, formData);
      trackRegistration(session, phoneNumber);
      showSuccess('Registration successful!');
      return { success: true };
    } catch (error) {
      logError('Registration failed', error);

      if (error.code === 'permission-denied') {
        showError('Registration failed. You may already be registered.');
      } else if (error.code === 'unavailable') {
        showError('Connection error. Please check your internet.');
      } else {
        showError('Registration failed. Please try again.');
      }

      return { success: false, error };
    } finally {
      setLoading(false);
    }
  }, [session, showSuccess, showError]);

  const redirectToZoom = useCallback(async () => {
    try {
      const links = await getZoomLinks();
      const zoomLink = links[session];

      if (!zoomLink) {
        showError('Zoom link not configured. Please contact your teacher.');
        return { success: false };
      }

      if (!zoomLink.includes('zoom.us')) {
        showError('Invalid Zoom link. Please contact your teacher.');
        return { success: false };
      }

      trackZoomRedirect(session);

      // Redirect after delay
      setTimeout(() => {
        window.location.href = zoomLink;
      }, 2000);

      return { success: true, zoomLink };
    } catch (error) {
      logError('Zoom redirect failed', error);
      showError('Unable to join class. Please contact your teacher.');
      return { success: false };
    }
  }, [session, showError]);

  return {
    loading,
    studentData,
    isReturningStudent,
    checkStudent,
    register,
    redirectToZoom,
  };
};
```

### 4.4 Country Selector Component

**File: `src/features/registration/components/CountrySelector.jsx`**
```javascript
import { countries } from '@/shared/constants/countries';

export default function CountrySelector({ value, onChange, error }) {
  return (
    <div className="mb-3">
      <label className="form-label fw-semibold">
        Country <span className="text-danger">*</span>
      </label>
      <select
        className={`form-select form-select-lg ${error ? 'is-invalid' : ''}`}
        value={value?.code || ''}
        onChange={(e) => {
          const country = countries.find(c => c.code === e.target.value);
          onChange(country);
        }}
      >
        <option value="">Select Country</option>
        {countries.map((country) => (
          <option key={country.code} value={country.code}>
            {country.flag} {country.name} ({country.dial})
          </option>
        ))}
      </select>
      {error && <div className="invalid-feedback">{error}</div>}
    </div>
  );
}
```

### 4.5 Phone Input Component

**File: `src/features/registration/components/PhoneInput.jsx`**
```javascript
export default function PhoneInput({
  country,
  value,
  onChange,
  isValid,
  error
}) {
  return (
    <div className="mb-3">
      <label className="form-label fw-semibold">
        Parent's Phone Number <span className="text-danger">*</span>
      </label>

      <div className="input-group input-group-lg">
        <span className="input-group-text">
          {country?.dial || '+'}
        </span>
        <input
          type="tel"
          className={`form-control ${isValid ? 'is-valid' : error ? 'is-invalid' : ''}`}
          placeholder={country?.format.replace(/X/g, '•') || 'Select country first'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={!country}
          maxLength={country?.length}
        />
      </div>

      {country && (
        <div className="form-text">
          Enter {country.length}-digit phone number
        </div>
      )}
      {error && <div className="invalid-feedback d-block">{error}</div>}
    </div>
  );
}
```

### 4.6 Check-in Card Component

**File: `src/features/registration/components/CheckinCard.jsx`**
```javascript
import { useState } from 'react';
import { motion } from 'framer-motion';
import CountrySelector from './CountrySelector';
import PhoneInput from './PhoneInput';
import { usePhoneValidation } from '../hooks/usePhoneValidation';
import { countries } from '@/shared/constants/countries';

export default function CheckinCard({ session, onSubmit, loading }) {
  const {
    selectedCountry,
    phoneNumber,
    isValid,
    handleCountryChange,
    handlePhoneChange,
    getFullPhoneNumber,
  } = usePhoneValidation();

  const [errors, setErrors] = useState({});

  // Set Kenya as default
  useState(() => {
    const kenya = countries.find(c => c.code === 'KE');
    handleCountryChange(kenya);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();

    const newErrors = {};
    if (!selectedCountry) newErrors.country = 'Please select a country';
    if (!isValid) newErrors.phone = `Please enter a valid ${selectedCountry?.length}-digit number`;

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      onSubmit(getFullPhoneNumber());
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card"
    >
      <div className="text-center mb-4">
        <h2 className="fw-bold mb-2">Welcome to Class</h2>
        <p className="text-muted">Enter your parent's phone number to continue</p>
      </div>

      <form onSubmit={handleSubmit}>
        <CountrySelector
          value={selectedCountry}
          onChange={handleCountryChange}
          error={errors.country}
        />

        <PhoneInput
          country={selectedCountry}
          value={phoneNumber}
          onChange={handlePhoneChange}
          isValid={isValid}
          error={errors.phone}
        />

        <button
          type="submit"
          className="btn btn-primary btn-lg w-100"
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Checking registration...
            </>
          ) : (
            <>
              Continue
              <i className="bi bi-arrow-right ms-2" />
            </>
          )}
        </button>
      </form>
    </motion.div>
  );
}
```

### 4.7 Registration Form Component

**File: `src/features/registration/components/RegistrationForm.jsx`**
```javascript
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
```

### 4.8 Welcome Back Card Component

**File: `src/features/registration/components/WelcomeBackCard.jsx`**
```javascript
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export default function WelcomeBackCard({
  session,
  studentData,
  onJoinNow,
  onBack,
  loading
}) {
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    if (countdown <= 0) {
      onJoinNow();
      return;
    }

    const timer = setTimeout(() => {
      setCountdown(countdown - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, onJoinNow]);

  const regDate = studentData.registeredAt?.toDate?.()
    .toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }) || 'Recently';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card"
    >
      <div className="py-4 text-center">
        {/* Profile Icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring' }}
          className="mb-4"
        >
          <div
            style={{
              width: '5rem',
              height: '5rem',
              background: `var(--${session}-gradient)`,
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.5rem',
              color: 'white',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {studentData.studentName.charAt(0).toUpperCase()}
          </div>
        </motion.div>

        {/* Welcome Message */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <h3 className="fw-bold mb-2">
            Welcome Back, {studentData.studentName}! 👋
          </h3>
          <p className="text-muted mb-4">
            We found your registration for <strong>{session} session</strong>
          </p>
        </motion.div>

        {/* Student Details */}
        <div className="text-start bg-light p-3 rounded mb-4">
          <div className="row mb-2">
            <div className="col-5 text-muted small">Class:</div>
            <div className="col-7"><strong>{studentData.class}</strong></div>
          </div>
          <div className="row mb-2">
            <div className="col-5 text-muted small">Subjects:</div>
            <div className="col-7"><strong>{studentData.subjects}</strong></div>
          </div>
          <div className="row">
            <div className="col-5 text-muted small">Registered:</div>
            <div className="col-7"><strong>{regDate}</strong></div>
          </div>
        </div>

        {/* Countdown */}
        <motion.div
          key={countdown}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
          className="alert alert-info mb-4"
        >
          <i className="bi bi-info-circle me-2" />
          Redirecting you to class in <strong>{countdown}</strong> seconds...
        </motion.div>

        {/* Loading Spinner */}
        <div className="spinner-border text-primary mb-4" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>

        {/* Manual Join Button */}
        <button
          className="btn btn-primary btn-lg w-100 mb-3"
          onClick={onJoinNow}
          disabled={loading}
        >
          Join Class Now
          <i className="bi bi-box-arrow-in-right ms-2" />
        </button>

        {/* Back Button */}
        <div className="mt-3">
          <button className="btn btn-link" onClick={onBack}>
            <i className="bi bi-arrow-left me-1" />
            Not you? Use different number
          </button>
        </div>
      </div>
    </motion.div>
  );
}
```

### 4.9 Success Screen Component

**File: `src/features/registration/components/SuccessScreen.jsx`**
```javascript
import { motion } from 'framer-motion';

export default function SuccessScreen({
  title,
  message,
  zoomLink,
  showSpinner = false
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card"
    >
      <div className="text-center py-5">
        {/* Success Icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', delay: 0.2 }}
          className="mb-4"
        >
          <div
            style={{
              width: '5rem',
              height: '5rem',
              background: 'rgba(16, 185, 129, 0.1)',
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '3rem',
              color: 'var(--success-color)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            ✓
          </div>
        </motion.div>

        <h3 className="fw-bold text-success mb-3">{title}</h3>
        <p className="text-muted mb-4">{message}</p>

        {showSpinner && (
          <div className="spinner-border text-primary mb-4" role="status">
            <span className="visually-hidden">Redirecting...</span>
          </div>
        )}

        {zoomLink && (
          <a
            href={zoomLink}
            className="btn btn-primary btn-lg"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Zoom Manually
            <i className="bi bi-box-arrow-up-right ms-2" />
          </a>
        )}
      </div>
    </motion.div>
  );
}
```

**✅ Phase 4 Deliverables:**
- [ ] All registration components created
- [ ] Form validation with Zod working
- [ ] Phone validation functional
- [ ] Check-in flow works
- [ ] Registration form works
- [ ] Welcome back screen works
- [ ] Countdown timer animates smoothly
- [ ] Zoom redirect works

---

## **PHASE 5: Dashboard Feature Components** (Day 3-4, 6-8 hours)

### 5.1 Dashboard Hook

**File: `src/features/dashboard/hooks/useDashboard.js`**
```javascript
import { useState, useEffect, useCallback } from 'react';
import {
  subscribeToStudents,
  deleteStudent as deleteStudentService,
  getZoomLinks,
  updateZoomLink as updateZoomLinkService,
} from '@services/firebase/firestore';
import { useToast } from '@/context/ToastContext';
import { logInfo, logError } from '@utils/logger';
import { trackStudentDelete, trackCSVExport } from '@utils/analytics';

export const useDashboard = () => {
  const [morningStudents, setMorningStudents] = useState([]);
  const [eveningStudents, setEveningStudents] = useState([]);
  const [zoomLinks, setZoomLinks] = useState({ morning: '', evening: '' });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('morning');
  const { showSuccess, showError } = useToast();

  // Subscribe to morning students
  useEffect(() => {
    const unsubscribe = subscribeToStudents('morning', (students) => {
      setMorningStudents(students);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to evening students
  useEffect(() => {
    const unsubscribe = subscribeToStudents('evening', (students) => {
      setEveningStudents(students);
    });
    return () => unsubscribe();
  }, []);

  // Load zoom links
  useEffect(() => {
    const loadLinks = async () => {
      try {
        const links = await getZoomLinks();
        setZoomLinks(links);
      } catch (error) {
        logError('Load zoom links failed', error);
      }
    };
    loadLinks();
  }, []);

  const updateZoomLink = useCallback(async (session, url) => {
    try {
      await updateZoomLinkService(session, url);
      setZoomLinks(prev => ({
        ...prev,
        [session]: url,
        [`${session}LastUpdated`]: new Date(),
      }));
      showSuccess(`${session.charAt(0).toUpperCase() + session.slice(1)} link updated!`);
      return { success: true };
    } catch (error) {
      logError('Update zoom link failed', error);
      showError('Failed to update link. Please try again.');
      return { success: false };
    }
  }, [showSuccess, showError]);

  const deleteStudent = useCallback(async (session, phoneNumber, studentName) => {
    try {
      await deleteStudentService(session, phoneNumber);
      trackStudentDelete(session);
      showSuccess(`${studentName} deleted successfully`);
      return { success: true };
    } catch (error) {
      logError('Delete student failed', error);
      showError('Failed to delete student. Please try again.');
      return { success: false };
    }
  }, [showSuccess, showError]);

  const exportToCSV = useCallback((session) => {
    const students = session === 'morning' ? morningStudents : eveningStudents;

    if (students.length === 0) {
      showError('No students to export');
      return;
    }

    // Build CSV
    let csv = 'Student Name,Parent Phone,Class,Subjects,Payment Receipt,Registered At\n';

    students.forEach(student => {
      const regDate = student.registeredAt?.toDate?.()
        .toLocaleString('en-GB') || 'N/A';

      csv += `"${student.studentName}",`;
      csv += `"${student.parentPhone}",`;
      csv += `"${student.class}",`;
      csv += `"${student.subjects}",`;
      csv += `"${student.receiptMessage.replace(/"/g, '""')}",`;
      csv += `"${regDate}"\n`;
    });

    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${session}-students-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    trackCSVExport(session, students.length);
    showSuccess('CSV exported successfully');
  }, [morningStudents, eveningStudents, showSuccess, showError]);

  return {
    morningStudents,
    eveningStudents,
    zoomLinks,
    loading,
    activeTab,
    setActiveTab,
    updateZoomLink,
    deleteStudent,
    exportToCSV,
    totalStudents: morningStudents.length + eveningStudents.length,
  };
};
```

### 5.2 Zoom Link Manager Component

**File: `src/features/dashboard/components/ZoomLinkManager.jsx`**
```javascript
import { useState } from 'react';
import { motion } from 'framer-motion';

export default function ZoomLinkManager({ zoomLinks, onUpdate, loading }) {
  const [morningLink, setMorningLink] = useState(zoomLinks.morning || '');
  const [eveningLink, setEveningLink] = useState(zoomLinks.evening || '');
  const [errors, setErrors] = useState({});

  const validateZoomLink = (url) => {
    if (!url || url.trim() === '') {
      return 'Please enter a Zoom link';
    }
    try {
      const urlObj = new URL(url);
      if (!urlObj.hostname.includes('zoom.us')) {
        return 'Please enter a valid Zoom meeting link (zoom.us)';
      }
      return null;
    } catch (e) {
      return 'Please enter a valid URL';
    }
  };

  const handleUpdate = async (session, url) => {
    const error = validateZoomLink(url);
    if (error) {
      setErrors(prev => ({ ...prev, [session]: error }));
      return;
    }

    setErrors(prev => ({ ...prev, [session]: null }));
    await onUpdate(session, url);
  };

  const showWarning = !zoomLinks.morning || !zoomLinks.evening;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="card mb-4"
    >
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">
          <i className="bi bi-link-45deg me-2" />
          Zoom Link Management
        </h5>
        <span className="badge bg-primary">Essential Setup</span>
      </div>

      <div className="card-body p-4">
        {showWarning && (
          <div className="alert alert-warning mb-4">
            <i className="bi bi-exclamation-triangle me-2" />
            <strong>Setup Required:</strong> Add your Zoom meeting links before sharing
            registration links with students.
          </div>
        )}

        {/* Morning Link */}
        <div className="link-input-group mb-4">
          <label className="form-label fw-semibold mb-3">
            <span className="session-badge morning-badge me-2">
              <i className="bi bi-sunrise-fill me-1" />
              Morning Session
            </span>
          </label>
          <div className="input-group input-group-lg mb-2">
            <span className="input-group-text">
              <i className="bi bi-camera-video" />
            </span>
            <input
              type="url"
              className={`form-control ${errors.morning ? 'is-invalid' : ''}`}
              placeholder="https://zoom.us/j/123456789?pwd=..."
              value={morningLink}
              onChange={(e) => setMorningLink(e.target.value)}
            />
            <button
              className={`btn ${zoomLinks.morning ? 'btn-success' : 'btn-primary'}`}
              style={{ minWidth: '130px' }}
              onClick={() => handleUpdate('morning', morningLink)}
              disabled={loading}
            >
              {loading ? (
                <span className="spinner-border spinner-border-sm" />
              ) : (
                <>
                  <i className={`bi bi-${zoomLinks.morning ? 'arrow-repeat' : 'plus-circle'} me-1`} />
                  {zoomLinks.morning ? 'Update' : 'Add'} Link
                </>
              )}
            </button>
          </div>
          {errors.morning && (
            <div className="text-danger small">{errors.morning}</div>
          )}
          <small className="text-muted">
            <i className="bi bi-clock me-1" />
            Last updated: {zoomLinks.morningLastUpdated
              ? new Date(zoomLinks.morningLastUpdated).toLocaleString()
              : 'Not set'}
          </small>
        </div>

        {/* Evening Link */}
        <div className="link-input-group">
          <label className="form-label fw-semibold mb-3">
            <span className="session-badge evening-badge me-2">
              <i className="bi bi-moon-stars-fill me-1" />
              Evening Session
            </span>
          </label>
          <div className="input-group input-group-lg mb-2">
            <span className="input-group-text">
              <i className="bi bi-camera-video" />
            </span>
            <input
              type="url"
              className={`form-control ${errors.evening ? 'is-invalid' : ''}`}
              placeholder="https://zoom.us/j/987654321?pwd=..."
              value={eveningLink}
              onChange={(e) => setEveningLink(e.target.value)}
            />
            <button
              className={`btn ${zoomLinks.evening ? 'btn-success' : 'btn-primary'}`}
              style={{ minWidth: '130px' }}
              onClick={() => handleUpdate('evening', eveningLink)}
              disabled={loading}
            >
              {loading ? (
                <span className="spinner-border spinner-border-sm" />
              ) : (
                <>
                  <i className={`bi bi-${zoomLinks.evening ? 'arrow-repeat' : 'plus-circle'} me-1`} />
                  {zoomLinks.evening ? 'Update' : 'Add'} Link
                </>
              )}
            </button>
          </div>
          {errors.evening && (
            <div className="text-danger small">{errors.evening}</div>
          )}
          <small className="text-muted">
            <i className="bi bi-clock me-1" />
            Last updated: {zoomLinks.eveningLastUpdated
              ? new Date(zoomLinks.eveningLastUpdated).toLocaleString()
              : 'Not set'}
          </small>
        </div>

        {/* Registration Links */}
        <div className="alert alert-info mt-4 mb-0">
          <h6 className="fw-bold mb-3">
            <i className="bi bi-clipboard-check me-2" />
            Share Registration Links with Students
          </h6>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="small text-muted mb-2">Morning Session Link:</label>
              <div className="input-group">
                <input
                  type="text"
                  className="form-control"
                  value={`${window.location.origin}/morning`}
                  readOnly
                />
                <button
                  className="btn copy-link-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/morning`);
                  }}
                >
                  <i className="bi bi-clipboard" />
                </button>
              </div>
            </div>
            <div className="col-md-6">
              <label className="small text-muted mb-2">Evening Session Link:</label>
              <div className="input-group">
                <input
                  type="text"
                  className="form-control"
                  value={`${window.location.origin}/evening`}
                  readOnly
                />
                <button
                  className="btn copy-link-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/evening`);
                  }}
                >
                  <i className="bi bi-clipboard" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
```

**Continue to Student Table, Stats Cards, and remaining dashboard components...**

Should I continue with the rest of Phase 5 (Student Table, Stats, Export, etc.) and then create Phase 6-8 (Testing, Optimization, Deployment)?
