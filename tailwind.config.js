/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#667eea',
        'primary-dark': '#764ba2',
        'morning-start': '#667eea',
        'morning-end': '#764ba2',
        'evening-start': '#f093fb',
        'evening-end': '#f5576c',
      },
      backgroundImage: {
        'primary-gradient': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'morning-gradient': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'evening-gradient': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'success-gradient': 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
        'danger-gradient': 'linear-gradient(135deg, #ee0979 0%, #ff6a00 100%)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
      },
      backdropBlur: {
        'glass': '10px',
      },
    },
  },
  plugins: [],
  // Important: Don't let Tailwind purge Bootstrap classes
  safelist: [
    'btn',
    'btn-primary',
    'btn-success',
    'btn-danger',
    'form-control',
    'form-select',
    'alert',
    'modal',
    'table',
  ],
}
