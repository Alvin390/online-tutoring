# 🚀 React Refactoring Master Plan
## Complete Transformation: Vanilla JS → React

**Project**: Online Tutoring Registration System
**Tech Stack**: Vite + React + JavaScript + Context API + Bootstrap 5 + Tailwind CSS
**Target**: Zero-bug, production-ready React application
**Estimated Time**: 3-5 days (phased implementation)

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Current Architecture Analysis](#current-architecture-analysis)
3. [Target React Architecture](#target-react-architecture)
4. [Phase-by-Phase Implementation](#phases)
5. [File-by-File Transformation Guide](#file-transformation)
6. [Testing Strategy](#testing)
7. [Deployment Guide](#deployment)

---

## 🎯 Project Overview

### Current State
- **5 HTML files**: index.html, morning.html, evening.html, dashboard.html, + docs
- **5 JavaScript files**: firebase-config.js, countries.js, logger.js, student-app.js, dashboard-app.js
- **1 CSS file**: styles.css (695 lines of custom Bootstrap)
- **1 Python server**: server.py (for logging)
- **Firestore structure**: `sessions/{morning|evening}/students/{phone}`

### Target State
- **Single React SPA**: Vite-powered, client-side routing
- **Context API**: Global state for auth, session data
- **React Hook Form + Zod**: Type-safe validation
- **Bootstrap 5 + Tailwind**: Hybrid styling approach
- **Firebase Analytics + Sentry**: Cloud logging
- **PWA**: Installable app
- **Vercel**: Production hosting

---

## 🔍 Current Architecture Analysis

### Key Components Identified

#### 1. **Student Registration Flow** (student-app.js - 872 lines)
- **Check-in Card**: Country selection + phone input
- **Registration Form**: 5 fields (name, class, subjects, payment)
- **Welcome Back Screen**: Returning student greeting + countdown
- **Zoom Redirect**: Auto-redirect after registration/check-in

#### 2. **Teacher Dashboard** (dashboard-app.js - 829 lines)
- **Login Screen**: Email/password Firebase auth
- **Zoom Link Management**: Add/update morning/evening links
- **Student List**: Tabs for morning/evening sessions
- **CSV Export**: Download student data

#### 3. **Shared Utilities**
- **Countries**: 52 countries with validation (countries.js)
- **Logger**: Client-side logging system (logger.js)
- **Firebase**: Modular SDK v10 (firebase-config.js)

### State Management Needs
- **Auth State**: Current user, login/logout
- **Session State**: Morning/evening, student data cache
- **UI State**: Loading, errors, toast notifications
- **Form State**: Registration inputs, validation errors

---

## 🏗️ Target React Architecture

### Folder Structure (Feature-Based)

```
online-tutoring-react/
├── public/
│   ├── favicon.ico
│   ├── manifest.json          # PWA manifest
│   └── robots.txt
│
├── src/
│   ├── features/              # Feature-based modules
│   │   ├── auth/
│   │   │   ├── components/
│   │   │   │   ├── LoginForm.jsx
│   │   │   │   └── ProtectedRoute.jsx
│   │   │   ├── context/
│   │   │   │   └── AuthContext.jsx
│   │   │   ├── hooks/
│   │   │   │   └── useAuth.js
│   │   │   └── index.js
│   │   │
│   │   ├── registration/
│   │   │   ├── components/
│   │   │   │   ├── CheckinCard.jsx
│   │   │   │   ├── RegistrationForm.jsx
│   │   │   │   ├── WelcomeBackCard.jsx
│   │   │   │   ├── CountrySelector.jsx
│   │   │   │   ├── PhoneInput.jsx
│   │   │   │   └── CountdownTimer.jsx
│   │   │   ├── hooks/
│   │   │   │   ├── useRegistration.js
│   │   │   │   └── usePhoneValidation.js
│   │   │   ├── schemas/
│   │   │   │   └── registrationSchema.js  # Zod schemas
│   │   │   └── index.js
│   │   │
│   │   ├── dashboard/
│   │   │   ├── components/
│   │   │   │   ├── DashboardLayout.jsx
│   │   │   │   ├── StatsCards.jsx
│   │   │   │   ├── ZoomLinkManager.jsx
│   │   │   │   ├── StudentTable.jsx
│   │   │   │   ├── StudentRow.jsx
│   │   │   │   └── ExportButton.jsx
│   │   │   ├── hooks/
│   │   │   │   ├── useDashboard.js
│   │   │   │   ├── useStudents.js
│   │   │   │   └── useZoomLinks.js
│   │   │   └── index.js
│   │   │
│   │   └── landing/
│   │       ├── components/
│   │       │   ├── LandingPage.jsx
│   │       │   ├── SessionCard.jsx
│   │       │   └── FeaturesSection.jsx
│   │       └── index.js
│   │
│   ├── shared/                # Shared/common code
│   │   ├── components/
│   │   │   ├── ui/            # Reusable UI components
│   │   │   │   ├── Button.jsx
│   │   │   │   ├── Card.jsx
│   │   │   │   ├── Modal.jsx
│   │   │   │   ├── Toast.jsx
│   │   │   │   ├── Spinner.jsx
│   │   │   │   └── ErrorBoundary.jsx
│   │   │   └── layout/
│   │   │       ├── Header.jsx
│   │   │       └── Footer.jsx
│   │   │
│   │   ├── hooks/
│   │   │   ├── useToast.js
│   │   │   ├── useLocalStorage.js
│   │   │   └── useOnlineStatus.js
│   │   │
│   │   ├── utils/
│   │   │   ├── logger.js      # Enhanced logger
│   │   │   ├── analytics.js   # Firebase Analytics wrapper
│   │   │   ├── errorTracking.js  # Sentry wrapper
│   │   │   ├── csvExport.js
│   │   │   └── dateFormatter.js
│   │   │
│   │   └── constants/
│   │       ├── countries.js   # 52 countries data
│   │       ├── classes.js     # Form 1-4
│   │       └── routes.js      # Route paths
│   │
│   ├── services/              # API/External services
│   │   ├── firebase/
│   │   │   ├── config.js      # Firebase init
│   │   │   ├── auth.js        # Auth methods
│   │   │   ├── firestore.js   # Firestore methods
│   │   │   └── analytics.js   # Analytics methods
│   │   └── zoom/
│   │       └── redirectService.js
│   │
│   ├── context/               # Global contexts
│   │   ├── AppContext.jsx     # Combined app context
│   │   └── ToastContext.jsx   # Toast notifications
│   │
│   ├── routes/                # Route configuration
│   │   ├── AppRoutes.jsx      # Main router
│   │   └── routeConfig.js     # Route definitions
│   │
│   ├── pages/                 # Page components
│   │   ├── LandingPage.jsx
│   │   ├── MorningPage.jsx
│   │   ├── EveningPage.jsx
│   │   ├── DashboardPage.jsx
│   │   ├── LoginPage.jsx
│   │   └── NotFoundPage.jsx
│   │
│   ├── styles/                # Global styles
│   │   ├── index.css          # Tailwind imports
│   │   ├── bootstrap-custom.scss  # Bootstrap overrides
│   │   └── animations.css     # Framer Motion + custom
│   │
│   ├── App.jsx                # Root component
│   ├── main.jsx               # Entry point
│   └── vite-env.d.js          # Vite env types (optional)
│
├── tests/                     # Testing suite
│   ├── unit/
│   │   ├── auth.test.js
│   │   ├── registration.test.js
│   │   └── dashboard.test.js
│   ├── integration/
│   │   └── userFlows.test.js
│   ├── utils/
│   │   └── testHelpers.js
│   └── setup.js
│
├── .env.example               # Environment template
├── .env.local                 # Firebase config (gitignored)
├── .gitignore
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── vercel.json                # Vercel deployment
├── README.md
└── REFACTORING.md             # This document
```

---

## 📦 Phase-by-Phase Implementation

### **PHASE 1: Project Setup & Infrastructure** (Day 1, 3-4 hours)

#### 1.1 Initialize Vite React Project

```bash
# Create new Vite React project
npm create vite@latest online-tutoring-react -- --template react

cd online-tutoring-react

# Install core dependencies
npm install

# Install routing
npm install react-router-dom

# Install form & validation
npm install react-hook-form zod @hookform/resolvers

# Install Firebase
npm install firebase

# Install UI libraries
npm install bootstrap react-bootstrap framer-motion

# Install Tailwind CSS
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# Install icons
npm install bootstrap-icons

# Install logging/analytics
npm install @sentry/react

# Install testing
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom

# Install PWA
npm install -D vite-plugin-pwa

# Install dev tools
npm install -D eslint prettier eslint-config-prettier
```

#### 1.2 Configure Tailwind CSS

**File: `tailwind.config.js`**
```javascript
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
```

#### 1.3 Configure Vite

**File: `vite.config.js`**
```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Online Tutoring Platform',
        short_name: 'Tutoring',
        description: 'Student Registration & Zoom Class Access',
        theme_color: '#667eea',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': '/src',
      '@features': '/src/features',
      '@shared': '/src/shared',
      '@services': '/src/services',
      '@utils': '/src/shared/utils',
      '@hooks': '/src/shared/hooks',
      '@components': '/src/shared/components',
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/analytics'],
          'vendor-forms': ['react-hook-form', 'zod'],
          'vendor-ui': ['bootstrap', 'react-bootstrap', 'framer-motion'],
        }
      }
    },
    chunkSizeWarningLimit: 1000,
  }
})
```

#### 1.4 Environment Variables Setup

**File: `.env.example`**
```env
# Firebase Configuration
VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef123456
VITE_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX

# Sentry (Error Tracking)
VITE_SENTRY_DSN=https://your_sentry_dsn@sentry.io/project_id

# App Configuration
VITE_APP_NAME=Online Tutoring Platform
VITE_APP_VERSION=2.0.0
VITE_ENABLE_ANALYTICS=true
VITE_LOG_LEVEL=info
```

**File: `.env.local`** (Create with actual Firebase values)
```env
# Copy from firebase-config.js
VITE_FIREBASE_API_KEY=AIzaSyDdtdrGxCKjoyEBE_5XRVYPDQAu8CPn5YQ
VITE_FIREBASE_AUTH_DOMAIN=online-tutoring-6d71a.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=online-tutoring-6d71a
VITE_FIREBASE_STORAGE_BUCKET=online-tutoring-6d71a.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=896061311479
VITE_FIREBASE_APP_ID=1:896061311479:web:77b180664b9f702ca406f2
VITE_FIREBASE_MEASUREMENT_ID=G-KZLESXTLPX

# Sentry - leave empty for now (free tier setup later)
VITE_SENTRY_DSN=

# App Config
VITE_APP_NAME=Online Tutoring Platform
VITE_APP_VERSION=2.0.0
VITE_ENABLE_ANALYTICS=true
VITE_LOG_LEVEL=debug
```

#### 1.5 Package.json Scripts

**File: `package.json`** (add scripts section)
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext js,jsx --report-unused-disable-directives --max-warnings 0",
    "format": "prettier --write \"src/**/*.{js,jsx,css,scss}\"",

    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:auth": "vitest run tests/unit/auth.test.js",
    "test:registration": "vitest run tests/unit/registration.test.js",
    "test:dashboard": "vitest run tests/unit/dashboard.test.js",
    "test:all": "vitest run",
    "test:coverage": "vitest run --coverage",

    "analyze": "vite-bundle-visualizer"
  }
}
```

**✅ Phase 1 Deliverables:**
- [ ] Vite React project initialized
- [ ] All dependencies installed
- [ ] Tailwind + Bootstrap configured
- [ ] Environment variables set up
- [ ] PWA configured
- [ ] Project runs with `npm run dev`

---

### **PHASE 2: Core Services & Utilities** (Day 1-2, 4-5 hours)

#### 2.1 Firebase Service Setup

**File: `src/services/firebase/config.js`**
```javascript
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);

// Initialize analytics conditionally
let analytics = null;
if (import.meta.env.VITE_ENABLE_ANALYTICS === 'true') {
  isSupported().then(supported => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  });
}

export { analytics };
export default app;
```

**File: `src/services/firebase/auth.js`**
```javascript
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';
import { auth } from './config';
import { logError } from '@utils/logger';

export const signIn = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error) {
    logError('Auth sign in failed', error);
    return {
      success: false,
      error: getAuthErrorMessage(error.code)
    };
  }
};

export const signOut = async () => {
  try {
    await firebaseSignOut(auth);
    return { success: true };
  } catch (error) {
    logError('Auth sign out failed', error);
    return { success: false, error: error.message };
  }
};

export const onAuthChange = (callback) => {
  return onAuthStateChanged(auth, callback);
};

const getAuthErrorMessage = (code) => {
  const errors = {
    'auth/invalid-email': 'Invalid email address format.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'Invalid email or password.',
    'auth/wrong-password': 'Invalid email or password.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/too-many-requests': 'Too many failed login attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Please check your connection.',
  };
  return errors[code] || 'Login failed. Please try again.';
};
```

**File: `src/services/firebase/firestore.js`**
```javascript
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy
} from 'firebase/firestore';
import { db } from './config';
import { logInfo, logError } from '@utils/logger';

// ============================================
// STUDENT OPERATIONS
// ============================================

export const checkStudentExists = async (session, phoneNumber) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
    const docSnap = await getDoc(docRef);

    logInfo('checkStudentExists', { session, phoneNumber, exists: docSnap.exists() });

    return {
      exists: docSnap.exists(),
      data: docSnap.exists() ? docSnap.data() : null
    };
  } catch (error) {
    logError('checkStudentExists failed', error);
    throw error;
  }
};

export const registerStudent = async (session, phoneNumber, data) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);

    const studentData = {
      studentName: data.studentName,
      parentPhone: phoneNumber,
      class: data.class,
      subjects: data.subjects,
      receiptMessage: data.receiptMessage,
      registeredAt: serverTimestamp(),
      lastAccessed: serverTimestamp(),
      session: session
    };

    await setDoc(docRef, studentData);
    logInfo('registerStudent success', { session, phoneNumber });

    return { success: true };
  } catch (error) {
    logError('registerStudent failed', error);
    throw error;
  }
};

export const updateLastAccessed = async (session, phoneNumber) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
    await setDoc(docRef, { lastAccessed: serverTimestamp() }, { merge: true });
    logInfo('updateLastAccessed success', { session, phoneNumber });
  } catch (error) {
    logError('updateLastAccessed failed', error);
  }
};

export const deleteStudent = async (session, phoneNumber) => {
  try {
    const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
    await deleteDoc(docRef);
    logInfo('deleteStudent success', { session, phoneNumber });
    return { success: true };
  } catch (error) {
    logError('deleteStudent failed', error);
    throw error;
  }
};

// ============================================
// DASHBOARD OPERATIONS
// ============================================

export const getStudents = async (session) => {
  try {
    const studentsRef = collection(db, 'sessions', session, 'students');
    const q = query(studentsRef, orderBy('registeredAt', 'desc'));
    const querySnapshot = await getDocs(q);

    const students = [];
    querySnapshot.forEach((doc) => {
      students.push({
        id: doc.id,
        ...doc.data()
      });
    });

    logInfo('getStudents success', { session, count: students.length });
    return students;
  } catch (error) {
    logError('getStudents failed', error);
    throw error;
  }
};

export const subscribeToStudents = (session, callback) => {
  const studentsRef = collection(db, 'sessions', session, 'students');
  const q = query(studentsRef, orderBy('registeredAt', 'desc'));

  return onSnapshot(q, (querySnapshot) => {
    const students = [];
    querySnapshot.forEach((doc) => {
      students.push({
        id: doc.id,
        ...doc.data()
      });
    });
    callback(students);
  }, (error) => {
    logError('subscribeToStudents error', error);
  });
};

// ============================================
// ZOOM LINK OPERATIONS
// ============================================

export const getZoomLinks = async () => {
  try {
    const docRef = doc(db, 'config', 'zoomLinks');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return docSnap.data();
    }
    return { morning: '', evening: '' };
  } catch (error) {
    logError('getZoomLinks failed', error);
    throw error;
  }
};

export const updateZoomLink = async (session, url) => {
  try {
    const docRef = doc(db, 'config', 'zoomLinks');
    await setDoc(docRef, {
      [session]: url,
      [`${session}LastUpdated`]: serverTimestamp()
    }, { merge: true });

    logInfo('updateZoomLink success', { session });
    return { success: true };
  } catch (error) {
    logError('updateZoomLink failed', error);
    throw error;
  }
};
```

#### 2.2 Logger Utility

**File: `src/shared/utils/logger.js`**
```javascript
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[import.meta.env.VITE_LOG_LEVEL || 'info'];

const formatMessage = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
};

const shouldLog = (level) => {
  return LOG_LEVELS[level] >= currentLevel;
};

export const logDebug = (message, meta) => {
  if (shouldLog('debug')) {
    console.debug(formatMessage('debug', message, meta));
  }
};

export const logInfo = (message, meta) => {
  if (shouldLog('info')) {
    console.info(formatMessage('info', message, meta));
  }
};

export const logWarn = (message, meta) => {
  if (shouldLog('warn')) {
    console.warn(formatMessage('warn', message, meta));
  }
};

export const logError = (message, error, meta) => {
  if (shouldLog('error')) {
    console.error(formatMessage('error', message, { ...meta, error: error?.message }));
  }

  // Send to Sentry in production
  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
    // Sentry will be initialized in Phase 3
  }
};

export default {
  debug: logDebug,
  info: logInfo,
  warn: logWarn,
  error: logError,
};
```

#### 2.3 Analytics Utility

**File: `src/shared/utils/analytics.js`**
```javascript
import { logEvent as firebaseLogEvent } from 'firebase/analytics';
import { analytics } from '@services/firebase/config';

export const logEvent = (eventName, params = {}) => {
  if (!analytics || import.meta.env.VITE_ENABLE_ANALYTICS !== 'true') {
    return;
  }

  try {
    firebaseLogEvent(analytics, eventName, params);
  } catch (error) {
    console.warn('Analytics event failed:', error);
  }
};

// Predefined events
export const trackRegistration = (session, phoneNumber) => {
  logEvent('registration_completed', { session, phoneNumber });
};

export const trackLogin = (email) => {
  logEvent('teacher_login', { email });
};

export const trackZoomRedirect = (session) => {
  logEvent('zoom_redirect', { session });
};

export const trackStudentDelete = (session) => {
  logEvent('student_deleted', { session });
};

export const trackCSVExport = (session, count) => {
  logEvent('csv_export', { session, studentCount: count });
};
```

#### 2.4 Countries Constants

**File: `src/shared/constants/countries.js`**
```javascript
// Copy from original countries.js with exact same structure
export const countries = [
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', dial: '+254', format: '7XX XXX XXX', length: 9 },
  { code: 'US', name: 'United States', flag: '🇺🇸', dial: '+1', format: '(XXX) XXX-XXXX', length: 10 },
  // ... all 52 countries
];

export const getCountryByCode = (code) => {
  return countries.find(c => c.code === code);
};

export const getCountryByDial = (dial) => {
  return countries.find(c => c.dial === dial);
};

export const validatePhoneNumber = (country, number) => {
  if (!country || !number) return false;
  const cleaned = number.replace(/\D/g, '');
  return cleaned.length === country.length;
};

export const formatPhoneNumber = (country, number) => {
  if (!country || !number) return number;
  const cleaned = number.replace(/\D/g, '');
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
};
```

**✅ Phase 2 Deliverables:**
- [ ] Firebase services configured
- [ ] Logger utility created
- [ ] Analytics utility created
- [ ] Countries constants migrated
- [ ] All services tested with console logs

---

### **PHASE 3: Context & State Management** (Day 2, 3-4 hours)

#### 3.1 Auth Context

**File: `src/features/auth/context/AuthContext.jsx`**
```javascript
import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthChange, signIn as firebaseSignIn, signOut as firebaseSignOut } from '@services/firebase/auth';
import { logInfo, logError } from '@utils/logger';
import { trackLogin } from '@utils/analytics';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthChange((firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
      logInfo('Auth state changed', { user: firebaseUser?.email || 'none' });
    });

    return () => unsubscribe();
  }, []);

  const signIn = async (email, password) => {
    setError(null);
    const result = await firebaseSignIn(email, password);

    if (result.success) {
      trackLogin(email);
      return { success: true };
    } else {
      setError(result.error);
      return { success: false, error: result.error };
    }
  };

  const signOut = async () => {
    const result = await firebaseSignOut();
    if (result.success) {
      setUser(null);
    }
    return result;
  };

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
```

#### 3.2 Toast Context

**File: `src/context/ToastContext.jsx`**
```javascript
import { createContext, useContext, useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import Toast from '@components/ui/Toast';

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((type, title, message, duration = 5000) => {
    const id = Date.now();
    const toast = { id, type, title, message, duration };

    setToasts(prev => [...prev, toast]);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const showSuccess = useCallback((message) => {
    showToast('success', 'Success', message);
  }, [showToast]);

  const showError = useCallback((message) => {
    showToast('error', 'Error', message);
  }, [showToast]);

  const showWarning = useCallback((message) => {
    showToast('warning', 'Warning', message);
  }, [showToast]);

  const showInfo = useCallback((message) => {
    showToast('info', 'Info', message);
  }, [showToast]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const value = {
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container">
        <AnimatePresence>
          {toasts.map(toast => (
            <Toast
              key={toast.id}
              {...toast}
              onClose={() => removeToast(toast.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};
```

**✅ Phase 3 Deliverables:**
- [ ] AuthContext created and tested
- [ ] ToastContext created and tested
- [ ] Auth flow works (login/logout)
- [ ] Toast notifications work

---

**Continue to PHASE 4-8 in separate documentation file...**

This is Part 1 of the master plan. Due to length, I'll create separate detailed files for:
- Phase 4-5: Component Development (Registration + Dashboard)
- Phase 6-7: Testing + Optimization
- Phase 8: Deployment

Should I continue with the remaining phases?
