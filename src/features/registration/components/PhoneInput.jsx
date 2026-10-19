import { hasTrunkZero } from '@/shared/constants/countries';

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
          inputMode="tel"
          autoComplete="tel-national"
          className={`form-control ${isValid ? 'is-valid' : error ? 'is-invalid' : ''}`}
          placeholder={country?.format.replace(/X/g, '•') || 'Select country first'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={!country}
          // +1 so a trunk "0" can be typed; it is stripped before validation.
          maxLength={country ? country.length + (hasTrunkZero(country) ? 1 : 0) : undefined}
        />
      </div>

      {country && (
        <div className="form-text">
          {hasTrunkZero(country)
            ? `Enter the ${country.length}-digit number — a leading 0 is fine, it is removed for you`
            : `Enter ${country.length}-digit phone number`}
        </div>
      )}
      {error && <div className="invalid-feedback d-block">{error}</div>}
    </div>
  );
}
