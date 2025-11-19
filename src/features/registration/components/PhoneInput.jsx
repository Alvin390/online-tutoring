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
