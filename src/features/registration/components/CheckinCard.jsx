import { useState, useEffect } from 'react';
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
