import { useState, useEffect, useRef } from 'react';
import { m } from 'framer-motion';
import CountrySelector from './CountrySelector';
import PhoneInput from './PhoneInput';
import { usePhoneValidation } from '../hooks/usePhoneValidation';
import { countries } from '@/shared/constants/countries';
import { parseNumberInput } from '@utils/admissionNumberInput';

/** The country whose dial code starts `phone` (longest match), or Kenya. */
function countryFor(phone) {
  const kenya = countries.find((c) => c.code === 'KE');
  if (!phone) return kenya;
  return [...countries].sort((a, b) => b.dial.length - a.dial.length).find((c) => phone.startsWith(c.dial)) ?? kenya;
}

/**
 * `waitSeconds` (002Fixes / 05): a rate-limit wait in progress — Continue stays disabled.
 * `slow` / `failedSlow` (007Fixes / 01): the check is taking long; the last one
 * failed on the network, so the button offers "Try again".
 *
 * 008Fixes / 04 (owner, 2026-11-14), when `numbers` is on: admission number
 * AND phone on one form. "First time with admission numbers?" hides the
 * number for that try (the page then confirms the phone and lets them choose
 * one). `initialPhone` refills the phone after choosing, with the number
 * field focused ("check in afresh"); `notice` is what the page has to say
 * (a refusal, or the next step).
 */
export default function CheckinCard({
  onSubmit, loading, waitSeconds = 0, slow = false, failedSlow = false,
  numbers = false, initialPhone = '', notice = null, focusNumber = false,
}) {
  const {
    selectedCountry,
    phoneNumber,
    isValid,
    handleCountryChange,
    handlePhoneChange,
    getFullPhoneNumber,
  } = usePhoneValidation();

  const [errors, setErrors] = useState({});
  const [number, setNumber] = useState('');
  const [phoneOnly, setPhoneOnly] = useState(false);
  const prefill = useRef(initialPhone);
  const numberInput = useRef(null);

  // Kenya by default — or the country of the number being refilled.
  useEffect(() => {
    const country = countryFor(prefill.current);
    if (country) handleCountryChange(country);
  }, [handleCountryChange]);

  // Refill the phone once the country is set (the setter reads it).
  useEffect(() => {
    if (!selectedCountry || !prefill.current) return;
    if (prefill.current.startsWith(selectedCountry.dial)) {
      handlePhoneChange(prefill.current.slice(selectedCountry.dial.length));
    }
    prefill.current = '';
  }, [selectedCountry, handlePhoneChange]);

  useEffect(() => {
    if (numbers && focusNumber) numberInput.current?.focus();
  }, [numbers, focusNumber]);

  const askNumber = numbers && !phoneOnly;

  const handleSubmit = (e) => {
    e.preventDefault();

    const newErrors = {};
    if (!selectedCountry) newErrors.country = 'Please select a country';
    if (!isValid) newErrors.phone = `Please enter a valid ${selectedCountry?.length}-digit number`;
    if (askNumber && !parseNumberInput(number)) {
      newErrors.number = 'Enter your 4-digit admission number (staff: S- and 4 digits).';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      onSubmit(getFullPhoneNumber(), askNumber ? number.trim() : '');
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
        <p className="text-muted">
          {askNumber
            ? "Enter your admission number and your parent's phone number"
            : "Enter your parent's phone number to continue"}
        </p>
      </div>

      {notice?.text && (
        <p
          className={`alert ${notice.tone === 'error' ? 'alert-danger' : 'alert-info'} small py-2 px-3 text-start`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
          data-testid="checkin-notice"
        >
          {notice.text}
        </p>
      )}

      <form onSubmit={handleSubmit}>
        {askNumber && (
          <div className="mb-3">
            <label className="form-label fw-semibold" htmlFor="ot-admission-number">
              Admission number <span className="text-danger">*</span>
            </label>
            <input
              id="ot-admission-number"
              ref={numberInput}
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={7}
              className={`form-control form-control-lg ${errors.number ? 'is-invalid' : ''}`}
              placeholder="e.g. 4071 (staff: S-4071)"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              aria-describedby="ot-admission-number-help"
            />
            {errors.number && <div className="invalid-feedback d-block">{errors.number}</div>}
            <div id="ot-admission-number-help" className="form-text">
              Forgot your number? Ask your teacher.
            </div>
          </div>
        )}

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
        {numbers && (
          <button
            type="button"
            className="btn btn-light btn-sm w-100 mt-2"
            onClick={() => { setPhoneOnly((v) => !v); setErrors({}); }}
            data-testid="phone-only-toggle"
          >
            {phoneOnly
              ? 'I have an admission number'
              : 'First time with admission numbers? Check in with your phone only'}
          </button>
        )}
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
