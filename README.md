# 🎓 Online Tutoring Platform - React Edition

A modern, production-ready React application for managing student registrations and Zoom class access with international phone number support, real-time updates, and comprehensive testing.

## 🚀 Tech Stack

- **Frontend**: React 19.2.0 + Vite 7.2.2
- **Routing**: React Router v7.9.6
- **State Management**: Context API
- **Forms**: React Hook Form + Zod validation
- **Styling**: Bootstrap 5.3.8 + Tailwind CSS 4.1.17
- **Animations**: Framer Motion 12.23.24
- **Backend**: Firebase 12.6.0 (Auth + Firestore + Analytics)
- **Error Tracking**: Sentry 10.26.0
- **Testing**: Vitest 4.0.10 + React Testing Library 16.3.0
- **PWA**: vite-plugin-pwa 1.1.0

## ✨ Features

### Student Experience
- **🌍 International Phone Support**: 50 countries with automatic validation
- **📱 Responsive Design**: Seamless experience across all devices
- **🎨 Stunning UI**: Glassmorphism effects, smooth animations, gradient backgrounds
- **⚡ Real-time**: Instant registration status checks
- **🔗 Smart Redirect**: Automatic Zoom class joining
- **🌓 Dual Sessions**: Separate morning/evening registration flows

### Teacher Dashboard
- **🔐 Secure Authentication**: Firebase-powered login
- **📊 Comprehensive Analytics**: Student statistics and insights
- **💾 Data Management**: View, search, filter, and delete registrations
- **📤 Export Functionality**: CSV export for student data
- **🔗 Zoom Link Management**: Configure class URLs
- **🔍 Real-time Search**: Instant student lookup

### Technical
- **🧪 Fully Tested**: 55 unit and integration tests
- **📦 Code Splitting**: Lazy-loaded routes for optimal performance
- **🎯 Type Safety**: Zod schema validation
- **🛡️ Error Boundaries**: Graceful error handling
- **📝 Comprehensive Logging**: Client-side logging with download capability
- **🚀 PWA Ready**: Installable progressive web app
- **⚠️ Production Monitoring**: Sentry error tracking

## 📦 Installation

### Prerequisites

- Node.js 18+
- npm or yarn
- Firebase account

### Setup

```bash
# Clone repository
git clone <repo-url>
cd online-tutoring

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env.local

# Add your Firebase credentials to .env.local
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id

# Run development server
npm run dev
```

The app will be available at `http://localhost:5173`

`npm run dev` starts **two** processes: the API (the Cloudflare Worker under
`wrangler dev` on port 8787, configured by `.dev.vars`) and the Vite dev server,
which forwards every `/api/*` request to it. Both stop with Ctrl+C. Without the
API running, pages load but every request fails with a 404.

- `npm run dev:quiet` — Vite only (when the API is running elsewhere; set
  `DEV_API_URL` to point the proxy at it)
- `npm run dev:api` — the Worker only

Note: `.dev.vars` points the local API at whichever Firebase project it names.
If that is the production project, local testing reads and writes real data.

### Testing M-Pesa (STK push) locally

With `DARAJA_MODE=dev` (sandbox), "Pay now" sends a real sandbox prompt to the
phone. Safaricom cannot call back to `http://localhost`, so after paying run:

```bash
npm run mpesa:reconcile   # asks Safaricom for the result now and posts it
```

For automatic confirmation, set `DARAJA_CALLBACK_BASE_URL` in `.dev.vars` to an
HTTPS tunnel to the API (e.g. `cloudflared tunnel --url http://localhost:8787`).
"Pay now" appears only on a Gold plan (`subscription/current.tier`) with the
`payments.daraja` flag on and the `DARAJA_*` credentials set.

## 🧪 Testing

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Test Coverage

- **55 tests** across 5 test suites
- **100% pass rate**
- Unit tests for hooks, utilities, constants, and schemas
- Integration tests for registration flow components

## 🏗️ Build & Deploy

### Production Build

```bash
# Build for production
npm run build

# Preview production build locally
npm run preview
```

### Deployment to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy to production
vercel --prod

# Or configure automatic deployment via GitHub integration
```

### Environment Variables for Production

Set these in your Vercel project settings:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_ENABLE_ANALYTICS` (true/false)
- `VITE_SENTRY_DSN` (optional, for error tracking)
- `VITE_LOG_LEVEL` (debug/info/warn/error)

## 📁 Project Structure

```
online-tutoring/
├── src/
│   ├── features/              # Feature-based modules
│   │   ├── auth/             # Authentication
│   │   │   ├── components/   # Login, ProtectedRoute
│   │   │   ├── context/      # AuthContext
│   │   │   └── hooks/        # useAuth
│   │   ├── registration/     # Student registration
│   │   │   ├── components/   # CheckinCard, RegistrationForm, etc.
│   │   │   ├── hooks/        # usePhoneValidation, useRegistration
│   │   │   └── schemas/      # Zod validation schemas
│   │   ├── dashboard/        # Teacher dashboard
│   │   │   ├── components/   # StudentTable, ZoomLinks, etc.
│   │   │   └── hooks/        # useDashboard
│   │   └── landing/          # Landing page
│   ├── shared/               # Shared resources
│   │   ├── components/ui/    # Reusable UI components
│   │   ├── hooks/            # Custom hooks
│   │   ├── utils/            # Utility functions (logger, analytics)
│   │   └── constants/        # Countries data
│   ├── services/             # External services
│   │   └── firebase/         # Firebase config and services
│   ├── context/              # Global contexts
│   ├── routes/               # Route configuration
│   ├── pages/                # Page components
│   ├── styles/               # Global styles
│   ├── App.jsx               # Root component
│   └── main.jsx              # Entry point
├── tests/
│   ├── unit/                 # Unit tests
│   └── integration/          # Integration tests
├── public/                   # Static assets
├── refactoring/              # Refactoring documentation
│   └── completed/            # Phase completion docs
├── .github/workflows/        # CI/CD pipelines
├── index.html                # HTML entry point
├── vite.config.js            # Vite configuration
├── vitest.config.js          # Test configuration
├── tailwind.config.js        # Tailwind configuration
├── vercel.json               # Vercel deployment config
└── package.json              # Dependencies
```

## 🎯 User Flows

### Student Registration Flow

1. **Landing Page**: Select Morning or Evening session
2. **Country Selection**: Choose country from 50+ options with flags
3. **Phone Input**: Enter parent's phone number (auto-validated)
4. **Status Check**:
   - **New Student**: Complete registration form
   - **Returning Student**: Welcome back message
5. **Join Class**: Automatic redirect to Zoom meeting

### Teacher Dashboard Flow

1. **Login**: Authenticate with teacher credentials
2. **Configure Zoom**: Set morning/evening meeting links
3. **View Students**: Browse all registrations by session
4. **Search & Filter**: Find students by name or phone
5. **Export Data**: Download CSV for reporting
6. **Manage**: Delete invalid registrations

## 🔒 Security Features

- **Firebase Security Rules**: Server-side data validation
- **Input Sanitization**: XSS protection on all user inputs
- **Schema Validation**: Zod validation for all forms
- **Authentication**: Protected routes for teacher dashboard
- **HTTPS Only**: Enforced in production
- **Security Headers**: X-Content-Type-Options, X-Frame-Options, XSS-Protection
- **Error Sanitization**: No sensitive data in production error messages

## 📱 PWA Features

This app is installable as a Progressive Web App:

- **Offline Capability**: Service worker caching
- **Add to Home Screen**: Native-like experience
- **Fast Loading**: Asset precaching
- **Update Prompts**: Automatic update notifications

## 🌍 Supported Countries

50 countries with automatic phone validation:

🇰🇪 Kenya | 🇺🇸 USA | 🇬🇧 UK | 🇨🇦 Canada | 🇦🇺 Australia | 🇮🇳 India | 🇿🇦 South Africa | 🇳🇬 Nigeria | 🇬🇭 Ghana | 🇺🇬 Uganda | 🇹🇿 Tanzania | 🇷🇼 Rwanda | 🇪🇹 Ethiopia | 🇿🇲 Zambia | 🇿🇼 Zimbabwe | 🇦🇪 UAE | 🇸🇦 Saudi Arabia | 🇪🇬 Egypt | 🇫🇷 France | 🇩🇪 Germany | 🇮🇹 Italy | 🇪🇸 Spain | 🇳🇱 Netherlands | 🇧🇪 Belgium | 🇨🇭 Switzerland | 🇸🇪 Sweden | 🇳🇴 Norway | 🇩🇰 Denmark | 🇫🇮 Finland | 🇵🇱 Poland | 🇧🇷 Brazil | 🇲🇽 Mexico | 🇦🇷 Argentina | 🇨🇱 Chile | 🇨🇴 Colombia | 🇵🇪 Peru | 🇨🇳 China | 🇯🇵 Japan | 🇰🇷 South Korea | 🇹🇭 Thailand | 🇻🇳 Vietnam | 🇵🇭 Philippines | 🇮🇩 Indonesia | 🇲🇾 Malaysia | 🇸🇬 Singapore | 🇳🇿 New Zealand | 🇵🇰 Pakistan | 🇧🇩 Bangladesh | 🇱🇰 Sri Lanka | 🇹🇷 Turkey

Each country includes:
- Flag emoji
- Dial code
- Phone format template
- Automatic length validation

## 📊 Database Structure

```
Firestore Collections:
├── config/
│   └── zoomLinks/
│       ├── morning: "https://zoom.us/..."
│       ├── evening: "https://zoom.us/..."
│       ├── morningUpdated: Timestamp
│       └── eveningUpdated: Timestamp
├── sessions/
│   ├── morning/
│   │   └── {phoneNumber}/
│   │       ├── studentName: string
│   │       ├── class: string
│   │       ├── subjects: string
│   │       ├── receiptMessage: string
│   │       ├── country: string
│   │       ├── phoneNumber: string
│   │       ├── createdAt: Timestamp
│   │       └── updatedAt: Timestamp
│   └── evening/
│       └── {phoneNumber}/
│           └── [same structure as morning]
```

## 🧰 Available Scripts

```bash
npm run dev          # Start the API (wrangler dev :8787) and Vite (:5173) together
npm run build        # Build for production
npm run preview      # Preview production build
npm run test         # Run all tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Generate coverage report
npm run lint         # Run ESLint (if configured)
```

## 🔧 Configuration Files

- **vite.config.js**: Build configuration, path aliases, PWA settings
- **vitest.config.js**: Test configuration, coverage settings
- **tailwind.config.js**: Custom colors, gradients, utilities
- **vercel.json**: Deployment config, security headers, caching
- **.env.local**: Environment variables (not committed)
- **.env.example**: Template for required environment variables

## 📈 Performance Targets

- **First Contentful Paint**: < 1.5s ✅
- **Largest Contentful Paint**: < 2.5s ✅
- **Time to Interactive**: < 3.5s ✅
- **Bundle Size**: < 500KB (gzipped) ✅
- **Test Coverage**: 100% pass rate ✅

## 🆘 Troubleshooting

### Development Server Won't Start

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Check Node version (should be 18+)
node --version
```

### Tests Failing

```bash
# Clear test cache
npm run test -- --clearCache

# Run tests with verbose output
npm run test -- --reporter=verbose
```

### Build Errors

```bash
# Check for TypeScript errors (if using TS)
npm run build -- --mode development

# Verify all environment variables are set
cat .env.local
```

### Firebase Connection Issues

- Verify `.env.local` has correct Firebase credentials
- Check Firebase Console for project status
- Ensure Firestore security rules are deployed
- Check browser console for specific error messages

## 📚 Documentation

Detailed phase-by-phase implementation documentation available in:
- `refactoring/completed/PHASE_1_COMPLETE.md` - Project Setup
- `refactoring/completed/PHASE_2_COMPLETE.md` - Core Services
- `refactoring/completed/PHASE_3_COMPLETE.md` - Context & State
- `refactoring/completed/PHASES_4-6_COMPLETE.md` - Features, Routing, Components
- `refactoring/completed/PHASE_7_COMPLETE.md` - Testing Infrastructure
- `refactoring/completed/PHASE_8_COMPLETE.md` - Deployment Configuration

## 🤝 Contributing

This is an educational project. For contributions:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

This project is created for educational purposes.

---

**Built with ❤️ using React, Vite, Firebase, and modern web technologies**

**Version**: 2.0.0 (React Refactor)
**Last Updated**: November 19, 2025
**Test Coverage**: 55 tests passing (100%)
