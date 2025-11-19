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
