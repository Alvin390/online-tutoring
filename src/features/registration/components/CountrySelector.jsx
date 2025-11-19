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
