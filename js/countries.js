// Country data with flags, codes, and phone number formats
export const countries = [
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', dial: '+254', format: '7XX XXX XXX', length: 9 },
  { code: 'US', name: 'United States', flag: '🇺🇸', dial: '+1', format: '(XXX) XXX-XXXX', length: 10 },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', dial: '+44', format: 'XXXX XXX XXX', length: 10 },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', dial: '+1', format: '(XXX) XXX-XXXX', length: 10 },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', dial: '+61', format: 'XXX XXX XXX', length: 9 },
  { code: 'IN', name: 'India', flag: '🇮🇳', dial: '+91', format: 'XXXXX XXXXX', length: 10 },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', dial: '+27', format: 'XX XXX XXXX', length: 9 },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', dial: '+234', format: 'XXX XXX XXXX', length: 10 },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭', dial: '+233', format: 'XX XXX XXXX', length: 9 },
  { code: 'UG', name: 'Uganda', flag: '🇺🇬', dial: '+256', format: 'XXX XXX XXX', length: 9 },
  { code: 'TZ', name: 'Tanzania', flag: '🇹🇿', dial: '+255', format: 'XXX XXX XXX', length: 9 },
  { code: 'RW', name: 'Rwanda', flag: '🇷🇼', dial: '+250', format: 'XXX XXX XXX', length: 9 },
  { code: 'ET', name: 'Ethiopia', flag: '🇪🇹', dial: '+251', format: 'XX XXX XXXX', length: 9 },
  { code: 'ZM', name: 'Zambia', flag: '🇿🇲', dial: '+260', format: 'XX XXX XXXX', length: 9 },
  { code: 'ZW', name: 'Zimbabwe', flag: '🇿🇼', dial: '+263', format: 'XX XXX XXXX', length: 9 },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', dial: '+971', format: 'XX XXX XXXX', length: 9 },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', dial: '+966', format: 'XX XXX XXXX', length: 9 },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬', dial: '+20', format: 'XXX XXX XXXX', length: 10 },
  { code: 'FR', name: 'France', flag: '🇫🇷', dial: '+33', format: 'X XX XX XX XX', length: 9 },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', dial: '+49', format: 'XXX XXXXXXX', length: 10 },
  { code: 'IT', name: 'Italy', flag: '🇮🇹', dial: '+39', format: 'XXX XXX XXXX', length: 10 },
  { code: 'ES', name: 'Spain', flag: '🇪🇸', dial: '+34', format: 'XXX XX XX XX', length: 9 },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱', dial: '+31', format: 'X XX XX XX XX', length: 9 },
  { code: 'BE', name: 'Belgium', flag: '🇧🇪', dial: '+32', format: 'XXX XX XX XX', length: 9 },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭', dial: '+41', format: 'XX XXX XX XX', length: 9 },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪', dial: '+46', format: 'XX XXX XX XX', length: 9 },
  { code: 'NO', name: 'Norway', flag: '🇳🇴', dial: '+47', format: 'XXX XX XXX', length: 8 },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰', dial: '+45', format: 'XX XX XX XX', length: 8 },
  { code: 'FI', name: 'Finland', flag: '🇫🇮', dial: '+358', format: 'XX XXX XXXX', length: 9 },
  { code: 'PL', name: 'Poland', flag: '🇵🇱', dial: '+48', format: 'XXX XXX XXX', length: 9 },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', dial: '+55', format: 'XX XXXXX-XXXX', length: 11 },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', dial: '+52', format: 'XXX XXX XXXX', length: 10 },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷', dial: '+54', format: 'XX XXXX-XXXX', length: 10 },
  { code: 'CL', name: 'Chile', flag: '🇨🇱', dial: '+56', format: 'X XXXX XXXX', length: 9 },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴', dial: '+57', format: 'XXX XXX XXXX', length: 10 },
  { code: 'PE', name: 'Peru', flag: '🇵🇪', dial: '+51', format: 'XXX XXX XXX', length: 9 },
  { code: 'CN', name: 'China', flag: '🇨🇳', dial: '+86', format: 'XXX XXXX XXXX', length: 11 },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', dial: '+81', format: 'XX XXXX XXXX', length: 10 },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷', dial: '+82', format: 'XX XXXX XXXX', length: 10 },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭', dial: '+66', format: 'XX XXX XXXX', length: 9 },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳', dial: '+84', format: 'XX XXX XXXX', length: 9 },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭', dial: '+63', format: 'XXX XXX XXXX', length: 10 },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩', dial: '+62', format: 'XXX XXX XXXX', length: 10 },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾', dial: '+60', format: 'XX XXX XXXX', length: 9 },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', dial: '+65', format: 'XXXX XXXX', length: 8 },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', dial: '+64', format: 'XX XXX XXXX', length: 9 },
  { code: 'PK', name: 'Pakistan', flag: '🇵🇰', dial: '+92', format: 'XXX XXX XXXX', length: 10 },
  { code: 'BD', name: 'Bangladesh', flag: '🇧🇩', dial: '+880', format: 'XXXX XXX XXX', length: 10 },
  { code: 'LK', name: 'Sri Lanka', flag: '🇱🇰', dial: '+94', format: 'XX XXX XXXX', length: 9 },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷', dial: '+90', format: 'XXX XXX XXXX', length: 10 }
];

// Get country by code
export function getCountryByCode(code) {
  return countries.find(c => c.code === code);
}

// Get country by dial code
export function getCountryByDial(dial) {
  return countries.find(c => c.dial === dial);
}

// Format phone number according to country format
export function formatPhoneNumber(country, number) {
  if (!country || !number) return number;
  
  // Remove all non-digit characters
  const cleaned = number.replace(/\D/g, '');
  
  // Apply country-specific formatting
  let formatted = '';
  let digitIndex = 0;
  
  for (let i = 0; i < country.format.length && digitIndex < cleaned.length; i++) {
    if (country.format[i] === 'X') {
      formatted += cleaned[digitIndex];
      digitIndex++;
    } else {
      formatted += country.format[i];
    }
  }
  
  return formatted;
}

// Validate phone number for specific country
export function validatePhoneNumber(country, number) {
  if (!country || !number) return false;
  
  // Remove all non-digit characters
  const cleaned = number.replace(/\D/g, '');
  
  // Check if length matches expected length
  return cleaned.length === country.length;
}
