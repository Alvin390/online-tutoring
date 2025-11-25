import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import CheckinCard from '@features/registration/components/CheckinCard';
import RegistrationForm from '@features/registration/components/RegistrationForm';
import WelcomeBackCard from '@features/registration/components/WelcomeBackCard';
import BlockedStudentScreen from '@features/registration/components/BlockedStudentScreen';
import SuccessScreen from '@features/registration/components/SuccessScreen';
import { useRegistration } from '@features/registration/hooks/useRegistration';

const SESSION = 'evening';

export default function EveningPage() {
  const [step, setStep] = useState('checkin'); // checkin, register, welcome, blocked, success, redirect
  const [phoneNumber, setPhoneNumber] = useState('');
  const [zoomLink, setZoomLink] = useState('');

  const {
    loading,
    studentData,
    isReturningStudent,
    checkStudent,
    register,
    redirectToZoom,
    submitReceipt,
  } = useRegistration(SESSION);

  const handleCheckin = async (phone) => {
    setPhoneNumber(phone);
    const { exists, data } = await checkStudent(phone);

    if (exists) {
      // Check if student is blocked
      if (data.blocked) {
        setStep('blocked');
      } else {
        setStep('welcome');
      }
    } else {
      setStep('register');
    }
  };

  const handleRegistration = async (formData) => {
    const result = await register(phoneNumber, formData);
    if (result.success) {
      setStep('success');
      handleRedirect();
    }
  };

  const handleRedirect = async () => {
    setStep('redirect');
    const result = await redirectToZoom();
    if (result.success) {
      setZoomLink(result.zoomLink);
    }
  };

  const handleSubmitReceipt = async (receiptMessage) => {
    await submitReceipt(receiptMessage);
    // Keep student on blocked screen to see pending status
  };

  const handleBack = () => {
    setStep('checkin');
    setPhoneNumber('');
  };

  return (
    <div
      className="hero-section"
      style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}
    >
      <div className="hero-overlay" />

      <div className="container position-relative">
        <div className="row min-vh-100 align-items-center justify-content-center py-5">
          <div className="col-lg-6 col-md-8">
            {/* Back Link */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 text-center"
            >
              <Link to="/" className="text-white text-decoration-none">
                <i className="bi bi-arrow-left me-2" />
                Back to Home
              </Link>
            </motion.div>

            {/* Session Badge */}
            <div className="text-center mb-4 animate-fade-in-up">
              <div className="session-badge evening-badge d-inline-flex">
                <i className="bi bi-moon-stars-fill me-2" />
                Evening Session
              </div>
            </div>

            {/* Dynamic Content */}
            <AnimatePresence mode="wait">
              {step === 'checkin' && (
                <CheckinCard
                  key="checkin"
                  session={SESSION}
                  onSubmit={handleCheckin}
                  loading={loading}
                />
              )}

              {step === 'register' && (
                <RegistrationForm
                  key="register"
                  session={SESSION}
                  phoneNumber={phoneNumber}
                  onSubmit={handleRegistration}
                  onBack={handleBack}
                  loading={loading}
                />
              )}

              {step === 'blocked' && studentData && (
                <BlockedStudentScreen
                  key="blocked"
                  session={SESSION}
                  studentData={studentData}
                  onSubmitReceipt={handleSubmitReceipt}
                  onBack={handleBack}
                  loading={loading}
                />
              )}

              {step === 'welcome' && studentData && (
                <WelcomeBackCard
                  key="welcome"
                  session={SESSION}
                  studentData={studentData}
                  onJoinNow={handleRedirect}
                  onBack={handleBack}
                  loading={loading}
                />
              )}

              {(step === 'success' || step === 'redirect') && (
                <SuccessScreen
                  key="success"
                  title={step === 'success' ? 'Registration Successful! ✓' : 'Redirecting to Class... 🎓'}
                  message={
                    step === 'success'
                      ? 'Preparing to redirect to class...'
                      : "Opening Zoom meeting. If it doesn't open automatically, click the button below."
                  }
                  zoomLink={zoomLink}
                  showSpinner={true}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
