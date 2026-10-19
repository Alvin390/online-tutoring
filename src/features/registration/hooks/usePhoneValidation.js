import { useState, useCallback } from 'react';
import { validatePhoneNumber, normaliseNationalNumber } from '@/shared/constants/countries';

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

    // Digits only, minus a typed trunk "0" (Phase 13 / 03 D4) — BEFORE the
    // length cap, which used to cut "0712345678" to "071234567".
    const cleaned = normaliseNationalNumber(selectedCountry, value);

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
