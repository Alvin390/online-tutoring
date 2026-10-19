# 🎓 Online Tutoring Platform - React Edition

A modern, production-ready React application for managing student registrations and Zoom class access with international phone number support, real-time updates, and comprehensive testing.

## 🚀 Tech Stack

- **Frontend**: React 19.2.0 + Vite 7.2.2
- **Routing**: React Router v7.9.6
- **State Management**: Context API
- **Forms**: React Hook Form + Zod validation
- **Styling**: Bootstrap 5.3.8 + Tailwind CSS 4.1.17
- **Animations**: Framer Motion 12.23.24
- **Hosting & API**: Cloudflare Workers (static assets + `/api/*` + cron sweeps)
- **Backend data**: Firebase (Auth + Firestore), reached from the Worker over REST
- **Payments**: Paystack (teacher plans), M-Pesa Daraja STK push (student fees)
- **Email**: Gmail API (bug-report and feature-request alerts)
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

The app runs on **Cloudflare Workers**: one Worker (`worker/index.js`) serves the
built SPA from `dist/` as static assets and the API under `/api/*` (the handlers
in `api/`, routed by `worker/routes.js`). Cron sweeps run from the same Worker
(`triggers.crons` in `wrangler.jsonc`). Data and auth stay on Firebase.

### Production build

```bash
npm run build        # health check, then vite build -> dist/
npm run check:bundle # per-route size budgets
```

### Deploying

```bash
npx wrangler login              # once per machine
npm run deploy                  # build, then upload a NEW VERSION (no traffic yet)
npx wrangler versions deploy    # promote it (optionally 10% first, then 100%)
npx wrangler rollback           # instant revert to the previous version
```

`npm run deploy` builds from `.env.local`, so the browser bundle gets the
`VITE_*` values on this machine. GitHub Actions (`.github/workflows/ci.yml`)
only tests: lint, unit, rules, handlers, `npm audit` and the bundle budget, on
every PR. Versions are uploaded by **Cloudflare Workers Builds** (the repo is
connected in the Cloudflare dashboard), which builds every push and runs
`npx wrangler versions upload`, so nothing goes live until it is promoted.

Firestore rules and indexes deploy separately, with the Firebase CLI:

```bash
npx firebase-tools deploy --only firestore:indexes --project online-tutoring-6d71a
npx firebase-tools deploy --only firestore:rules   --project online-tutoring-6d71a
```

**The full deploy order, the secrets table and the incident runbooks are in
[`docs/LAUNCH.md`](docs/LAUNCH.md). Read it before a production deploy.**

### Environment variables

Two halves (details in `docs/LAUNCH.md` §2 and `.env.example`):

- **Build-time `VITE_*`** (Firebase web config, Sentry DSN, log level): inlined
  into the browser bundle, so public by construction; never put a secret here.
- **Runtime secrets** (service account, Paystack, Daraja, Gmail, `CRON_SECRET`,
  `PUBLIC_BASE_URL`, …): Cloudflare Worker secrets in production
  (`npm run cf:secrets -- --only NAME`), `.dev.vars` locally.

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
├── api/                      # API handlers (one file per endpoint) + api/_lib shared code
├── worker/                   # Cloudflare Worker entry (index.js) and route table (routes.js)
├── docs/                     # LAUNCH.md (deploy + runbooks), DATA_MODEL.md, GMAIL_SETUP.md
├── public/                   # Static assets
├── .github/workflows/        # CI/CD pipelines
├── index.html                # HTML entry point
├── vite.config.js            # Vite configuration
├── vitest.config.js          # Test configuration
├── tailwind.config.js        # Tailwind configuration
├── wrangler.jsonc            # Worker config: assets, crons, vars
├── firestore.rules           # Firestore security rules
├── firestore.indexes.json    # Firestore indexes
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

The full model (sessions, students, fee ledger, reports, subscription, config
documents) is in [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md). In short:

```
sessions/{slug}                      name, description, schedule, classes, icon, gradient, order, active
  private/classLink                  the class link (served by the API to admitted students only)
  students/{phone}                   registration, approval and fee state
    ledger/{id}, notes/{id}          fee transactions, teacher notes
config/flags, config/notifications   feature flags, report-email recipient
subscription/current                 the teacher's plan (bronze / silver / gold)
reports/{id}                         bug reports and feature requests
audit/{id}                           who changed what
```

## 🧰 Available Scripts

```bash
npm run dev          # Start the API (wrangler dev :8787) and Vite (:5173) together
npm run build        # Build for production
npm run preview      # Preview production build
npm run test         # Run all tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Generate coverage report
npm run lint         # ESLint (0 warnings allowed)
npm run test:rules   # Firestore rules tests (emulator)
npm run test:handlers # API handler tests (Firestore + Auth emulators)
npm run deploy       # Build and upload a Worker version (see Build & Deploy)
npm run cf:secrets   # Upload runtime secrets to the Worker (use --only NAME)
npm run cf:tail      # Stream production Worker logs
npm run mpesa:reconcile # Local: confirm sandbox STK payments (no callback on localhost)
npm run gmail:auth   # One-time Gmail refresh token (docs/GMAIL_SETUP.md)
```

## 🔧 Configuration Files

- **vite.config.js**: Build configuration, path aliases, PWA settings
- **vitest.config.js**: Test configuration, coverage settings
- **tailwind.config.js**: Custom colors, gradients, utilities
- **wrangler.jsonc**: Worker name, static assets, cron triggers, non-secret vars
- **firestore.rules / firestore.indexes.json**: Firestore security rules and indexes
- **.dev.vars**: Runtime secrets for `wrangler dev` (not committed)
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

- [`docs/LAUNCH.md`](docs/LAUNCH.md): deploy order, secrets, flag rollout, incident runbooks, rollback
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md): Firestore collections and documents
- [`docs/GMAIL_SETUP.md`](docs/GMAIL_SETUP.md): one-time Gmail API setup for report emails

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
