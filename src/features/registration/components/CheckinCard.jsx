import { useState, useEffect } from 'react';
import { m } from 'framer-motion';
import CountrySelector from './CountrySelector';
import PhoneInput from './PhoneInput';
import { usePhoneValidation } from '../hooks/usePhoneValidation';
import { countries } from '@/shared/constants/countries';

/**
 * `waitSeconds` (002Fixes / 05): a rate-limit wait in progress — Continue stays disabled.
 * `slow` / `failedSlow` (007Fixes / 01): the check is taking long; the last one
 * failed on the network, so the button offers "Try again".
 */
export default function CheckinCard({ onSubmit, loading, waitSeconds = 0, slow = false, failedSlow = false }) {
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
  useEffect(() => {
    const kenya = countries.find(c => c.code === 'KE');
    if (kenya) {
      handleCountryChange(kenya);
    }
  }, [handleCountryChange]);

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
    <m.div
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
          disabled={loading || waitSeconds > 0}
        >
          {loading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Checking registration...
            </>
          ) : failedSlow ? (
            <>
              <i className="bi bi-arrow-clockwise me-2" aria-hidden="true" />
              Try again
            </>
          ) : (
            <>
              Continue
              <i className="bi bi-arrow-right ms-2" />
            </>
          )}
        </button>
        {/* 007Fixes / 01: said once, politely, while a class-time request is slow. */}
        {slow && (
          <p className="alert alert-light small py-2 px-3 mt-3 mb-0 text-start" role="status" aria-live="polite">
            <i className="bi bi-wifi-1 me-1" aria-hidden="true" />
            Still connecting… your network seems slow. Please wait.
          </p>
        )}
      </form>
    </m.div>
  );
}
