# Complete System Rundown: Student Registration & Zoom Access System
## Comprehensive Technical & UX Documentation

---

## Table of Contents
1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Firebase Architecture](#firebase-architecture)
4. [Initial Setup & Configuration](#initial-setup)
5. [Teacher Dashboard - Complete Flow](#teacher-dashboard)
6. [Student Registration - Complete Flow](#student-registration)
7. [Returning Student Flow](#returning-student)
8. [Session Switching](#session-switching)
9. [UI/UX Design Specifications](#uiux-design)
10. [Technical Implementation Details](#technical-implementation)
11. [Security & Validation](#security-validation)
12. [Edge Cases & Error Handling](#edge-cases)
13. [Performance Optimization](#performance)
14. [Testing Strategy](#testing)
15. [Deployment Guide](#deployment)
16. [Maintenance & Monitoring](#maintenance)

---

## 1. System Overview {#system-overview}

### Purpose
A lightweight, zero-backend web application enabling students to register for morning or evening Zoom classes using their parent's phone number as a unique identifier. Teachers manage Zoom links and review student registrations through a centralized dashboard.

### Core Features
- **Student Self-Registration**: Phone-based identity with automatic duplicate prevention
- **Session Management**: Separate morning and evening class registrations
- **Teacher Control Panel**: Link management and student data review
- **Smart Redirects**: Returning students bypass registration
- **Cross-Device Support**: Phone number ensures continuity across devices

### User Roles
1. **Students**: Register once per session, access Zoom classes
2. **Teacher**: Manage Zoom links, view/delete registrations, verify payments

---

## 2. Technology Stack {#technology-stack}

### Frontend
```
- HTML5 (Semantic markup)
- CSS3 + Bootstrap 5.3
- Vanilla JavaScript (ES6+)
- Firebase SDK 10.x (Web)
```

### Backend (Serverless)
```
- Firebase Firestore (NoSQL Database)
- Firebase Authentication (Teacher login)
- Firebase Hosting or Vercel (Static hosting)
```

### Key Libraries
```javascript
// Firebase
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

// Bootstrap (via CDN)
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
```

### Why This Stack?
- **Zero backend complexity**: No server maintenance
- **Real-time updates**: Firebase sync
- **Free hosting**: Vercel/Firebase free tiers
- **Rapid development**: Bootstrap for quick UI
- **Scalable**: Handles 100-10,000+ users
- **Mobile-first**: Responsive by default

---

## 3. Firebase Architecture {#firebase-architecture}

### Database Structure (Firestore)

```javascript
yourproject-firebase/
│
├── config/                          // System configuration
│   └── zoomLinks/                   // Document ID: "links"
│       ├── morning: String          // "https://zoom.us/j/123456789"
│       ├── evening: String          // "https://zoom.us/j/987654321"
│       ├── morningLastUpdated: Timestamp
│       ├── eveningLastUpdated: Timestamp
│       └── createdAt: Timestamp
│
├── sessions/                        // Collection
│   ├── morning/                     // Sub-collection
│   │   ├── 0712345678/             // Document ID: parent phone
│   │   │   ├── studentName: String
│   │   │   ├── parentPhone: String // Same as doc ID
│   │   │   ├── class: String
│   │   │   ├── subjects: String
│   │   │   ├── receiptMessage: String
│   │   │   ├── registeredAt: Timestamp
│   │   │   └── lastAccessed: Timestamp
│   │   ├── 0723456789/
│   │   │   └── {...}
│   │   └── ...
│   │
│   └── evening/                     // Sub-collection
│       ├── 0734567890/
│       │   └── {...}
│       └── ...
│
└── admin/                           // Collection (optional)
    └── users/                       // Teacher accounts
        └── teacher1@email.com/
            ├── email: String
            ├── role: "teacher"
            └── createdAt: Timestamp
```

### Security Rules (Firestore)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Config - Teachers only can write, students can read
    match /config/{document=**} {
      allow read: if true;  // Anyone can read Zoom links
      allow write: if request.auth != null;  // Only authenticated teachers
    }
    
    // Sessions - Students can create their own, teachers can manage all
    match /sessions/{session}/{phone} {
      // Students can create their own registration
      allow create: if phone == request.resource.data.parentPhone;
      
      // Students can read their own data
      allow read: if true;
      
      // Only teachers can delete
      allow delete: if request.auth != null;
      
      // No updates allowed (prevent tampering)
      allow update: if false;
    }
    
    // Admin collection - Teachers only
    match /admin/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### Data Model Details

#### Student Registration Document
```javascript
{
  studentName: "John Doe",           // Student's full name
  parentPhone: "0712345678",         // Parent's phone (unique ID)
  class: "Form 2",                   // Student's class/grade
  subjects: "Math, Physics, Chemistry", // Subjects enrolled
  receiptMessage: "M-Pesa Ref: XYZ789, Paid KES 5000", // Payment details
  registeredAt: Timestamp(2025-10-21 09:30:00),
  lastAccessed: Timestamp(2025-10-21 14:45:00)  // Track usage
}
```

#### Zoom Links Configuration Document
```javascript
{
  morning: "https://zoom.us/j/123456789?pwd=abc123",
  evening: "https://zoom.us/j/987654321?pwd=def456",
  morningLastUpdated: Timestamp(2025-10-21 08:00:00),
  eveningLastUpdated: Timestamp(2025-10-21 08:00:00),
  createdAt: Timestamp(2025-10-20 15:00:00)
}
```

---

## 4. Initial Setup & Configuration {#initial-setup}

### Firebase Project Setup

**Step 1: Create Firebase Project**
```
1. Go to console.firebase.google.com
2. Click "Add Project"
3. Name: "student-zoom-registration"
4. Disable Google Analytics (optional)
5. Create project
```

**Step 2: Enable Firestore Database**
```
1. Firebase Console → Build → Firestore Database
2. Click "Create database"
3. Start in Production mode
4. Choose location: closest to Kenya (e.g., europe-west)
5. Click Enable
```

**Step 3: Set Up Authentication**
```
1. Firebase Console → Build → Authentication
2. Click "Get started"
3. Sign-in method → Email/Password → Enable
4. Add teacher user:
   - Email: teacher@school.com
   - Password: [secure password]
```

**Step 4: Deploy Security Rules**
```
1. Firestore → Rules tab
2. Paste security rules from section 3
3. Click Publish
```

**Step 5: Get Firebase Config**
```javascript
// Firebase Console → Project Settings → General → Your apps
// Add web app → Copy config object

const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};
```

---

## 5. Teacher Dashboard - Complete Flow {#teacher-dashboard}

### 5.1 Dashboard Access & Authentication

#### URL Structure
```
https://yoursite.com/dashboard.html
```

#### Login Screen (First Load)

**UI Layout:**
```
┌─────────────────────────────────────────┐
│                                          │
│          🎓 Teacher Dashboard            │
│                                          │
│  ┌────────────────────────────────┐     │
│  │  Email                          │     │
│  │  [teacher@school.com        ]   │     │
│  │                                 │     │
│  │  Password                       │     │
│  │  [••••••••••••••          ]    │     │
│  │                                 │     │
│  │      [Login to Dashboard]       │     │
│  └────────────────────────────────┘     │
│                                          │
└─────────────────────────────────────────┘
```

**Technical Implementation:**
```javascript
// dashboard-app.js - Authentication
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';

const auth = getAuth();

// Check if already logged in
onAuthStateChanged(auth, (user) => {
  if (user) {
    showDashboard();
  } else {
    showLoginForm();
  }
});

// Login handler
async function handleLogin(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    showDashboard();
  } catch (error) {
    if (error.code === 'auth/invalid-credential') {
      showError('Invalid email or password');
    } else if (error.code === 'auth/too-many-requests') {
      showError('Too many failed attempts. Try again later.');
    } else {
      showError('Login failed. Please try again.');
    }
  }
}
```

**UX Enhancements:**
- Auto-focus on email field on load
- Show/hide password toggle button
- Loading spinner during authentication
- Remember last login (Firebase handles this)
- "Forgot password?" link (optional Phase 2)

---

### 5.2 Dashboard Main Interface

#### Layout Structure

```
┌──────────────────────────────────────────────────────────────────┐
│  🎓 Student Registration Dashboard          [Logout]             │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ⚙️ ZOOM LINK MANAGEMENT                                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Morning Session                                            │ │
│  │  ┌──────────────────────────────────────────┐              │ │
│  │  │ https://zoom.us/j/123456789              │ [Add Link]   │ │
│  │  └──────────────────────────────────────────┘              │ │
│  │  💡 Last updated: Not set                                   │ │
│  │                                                              │ │
│  │  Evening Session                                            │ │
│  │  ┌──────────────────────────────────────────┐              │ │
│  │  │ https://zoom.us/j/987654321              │ [Add Link]   │ │
│  │  └──────────────────────────────────────────┘              │ │
│  │  💡 Last updated: Not set                                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  👥 REGISTERED STUDENTS                                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  [Morning Session (0)] [Evening Session (0)]               │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │                                                              │ │
│  │  ℹ️ No students registered yet                              │ │
│  │  Share the registration links with your students:          │ │
│  │  Morning: yoursite.com/morning  [Copy]                     │ │
│  │  Evening: yoursite.com/evening  [Copy]                     │ │
│  │                                                              │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

### 5.3 First-Time Setup Flow

#### Step 1: Dashboard Load (No Links Set)

**Visual State:**
- Zoom link input fields: **Empty**
- Button text: **"Add Link"**
- Button color: **Blue (primary)**
- Warning banner at top:
  ```
  ⚠️ Setup Required: Add your Zoom meeting links before sharing registration links with students
  ```

**Code Implementation:**
```javascript
// Load zoom links from Firebase
async function loadZoomLinks() {
  const docRef = doc(db, 'config', 'zoomLinks');
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists() && docSnap.data().morning && docSnap.data().evening) {
    // Links exist - update mode
    const data = docSnap.data();
    document.getElementById('morningLinkInput').value = data.morning;
    document.getElementById('eveningLinkInput').value = data.evening;
    document.getElementById('morningBtn').textContent = 'Update Link';
    document.getElementById('eveningBtn').textContent = 'Update Link';
    document.getElementById('morningBtn').classList.replace('btn-primary', 'btn-success');
    document.getElementById('eveningBtn').classList.replace('btn-primary', 'btn-success');
    
    // Show last updated times
    if (data.morningLastUpdated) {
      showLastUpdated('morning', data.morningLastUpdated);
    }
    if (data.eveningLastUpdated) {
      showLastUpdated('evening', data.eveningLastUpdated);
    }
    
    // Hide setup warning
    document.getElementById('setupWarning').style.display = 'none';
  } else {
    // First time - add mode
    document.getElementById('morningBtn').textContent = 'Add Link';
    document.getElementById('eveningBtn').textContent = 'Add Link';
    document.getElementById('setupWarning').style.display = 'block';
  }
}
```

#### Step 2: Teacher Adds Morning Link

**User Action:**
1. Teacher pastes: `https://zoom.us/j/123456789?pwd=abc123`
2. Clicks **"Add Link"** button

**Validation:**
```javascript
function validateZoomLink(url) {
  // Check if empty
  if (!url || url.trim() === '') {
    return { valid: false, message: 'Please enter a Zoom link' };
  }
  
  // Check if it's a valid URL
  try {
    const urlObj = new URL(url);
    
    // Check if it's a Zoom domain
    if (!urlObj.hostname.includes('zoom.us')) {
      return { valid: false, message: 'Please enter a valid Zoom meeting link (zoom.us)' };
    }
    
    return { valid: true };
  } catch (e) {
    return { valid: false, message: 'Please enter a valid URL' };
  }
}
```

**Save to Firebase:**
```javascript
async function addMorningLink(url) {
  // Validate
  const validation = validateZoomLink(url);
  if (!validation.valid) {
    showErrorToast(validation.message);
    return;
  }
  
  // Show loading state
  const btn = document.getElementById('morningBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';
  
  try {
    const docRef = doc(db, 'config', 'zoomLinks');
    
    // Check if document exists
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      // Update existing
      await setDoc(docRef, {
        morning: url,
        morningLastUpdated: serverTimestamp()
      }, { merge: true });
    } else {
      // Create new document
      await setDoc(docRef, {
        morning: url,
        evening: '',
        morningLastUpdated: serverTimestamp(),
        createdAt: serverTimestamp()
      });
    }
    
    // Success feedback
    showSuccessToast('✓ Morning link added successfully!');
    btn.textContent = 'Update Link';
    btn.classList.replace('btn-primary', 'btn-success');
    btn.disabled = false;
    
    // Update last updated time display
    showLastUpdated('morning', new Date());
    
    // Check if both links are now set
    checkSetupComplete();
    
  } catch (error) {
    console.error('Error saving link:', error);
    showErrorToast('Failed to save link. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Add Link';
  }
}
```

**UI Feedback:**
```
Before click:
┌──────────────────────────────────────┐
│ https://zoom.us/j/123456789          │ [Add Link]
└──────────────────────────────────────┘

During save (Loading):
┌──────────────────────────────────────┐
│ https://zoom.us/j/123456789          │ [⟳ Saving...]
└──────────────────────────────────────┘

After success:
┌──────────────────────────────────────┐
│ https://zoom.us/j/123456789          │ [Update Link]
└──────────────────────────────────────┘
✓ Morning link added successfully!
💡 Last updated: Oct 21, 2025 10:30 AM
```

#### Step 3: Teacher Adds Evening Link

**Same process as morning**

**After Both Links Added:**
```
Setup warning banner disappears
Both buttons show "Update Link" in green
Dashboard is now fully operational
```

---

### 5.4 Managing Zoom Links (Update Mode)

#### Updating an Existing Link

**Scenario:** Teacher needs to change morning Zoom link

**User Flow:**
1. Teacher clicks in morning link input field
2. Edits URL: `https://zoom.us/j/999999999?pwd=new123`
3. Clicks **"Update Link"** button (green)

**Code Implementation:**
```javascript
async function updateMorningLink(url) {
  // Validation (same as add)
  const validation = validateZoomLink(url);
  if (!validation.valid) {
    showErrorToast(validation.message);
    return;
  }
  
  // Confirmation dialog (optional but recommended)
  const confirmed = await showConfirmDialog(
    'Update Morning Link',
    'Students will be redirected to the new link. Continue?'
  );
  
  if (!confirmed) return;
  
  // Show loading
  const btn = document.getElementById('morningBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Updating...';
  
  try {
    const docRef = doc(db, 'config', 'zoomLinks');
    await setDoc(docRef, {
      morning: url,
      morningLastUpdated: serverTimestamp()
    }, { merge: true });
    
    // Success
    showSuccessToast('✓ Morning link updated!');
    btn.disabled = false;
    btn.textContent = 'Update Link';
    
    // Update timestamp display
    showLastUpdated('morning', new Date());
    
  } catch (error) {
    console.error('Error updating link:', error);
    showErrorToast('Failed to update link. Please try again.');
    btn.disabled = false;
  }
}
```

**UI States:**
```
Normal state:
[Update Link] - Green button, enabled

Loading state:
[⟳ Updating...] - Green button, disabled, spinner

Success state:
[Update Link] - Returns to normal, shows toast
✓ Morning link updated!
💡 Last updated: Oct 21, 2025 11:45 AM
```

#### Using Same Link for Both Sessions

**Scenario:** Teacher wants both sessions to use same Zoom room

**User Flow:**
1. Copy morning link
2. Paste in evening link field
3. Click "Add Link" or "Update Link"
4. System accepts (no validation preventing duplicate)

**Why This Works:**
- Some teachers prefer one room for all classes
- System doesn't enforce unique links
- Teacher has full control

---

### 5.5 Student Management Interface

#### Tab Structure

```html
<!-- Bootstrap Nav Tabs -->
<ul class="nav nav-tabs" id="sessionTabs" role="tablist">
  <li class="nav-item" role="presentation">
    <button class="nav-link active" id="morning-tab" data-bs-toggle="tab" 
            data-bs-target="#morning" type="button" role="tab">
      Morning Session (<span id="morningCount">0</span>)
    </button>
  </li>
  <li class="nav-item" role="presentation">
    <button class="nav-link" id="evening-tab" data-bs-toggle="tab" 
            data-bs-target="#evening" type="button" role="tab">
      Evening Session (<span id="eveningCount">0</span>)
    </button>
  </li>
</ul>

<div class="tab-content" id="sessionTabContent">
  <!-- Morning Students -->
  <div class="tab-pane fade show active" id="morning" role="tabpanel">
    <div id="morningStudents"></div>
  </div>
  
  <!-- Evening Students -->
  <div class="tab-pane fade" id="evening" role="tabpanel">
    <div id="eveningStudents"></div>
  </div>
</div>
```

#### Loading Students from Firebase

```javascript
// Load all students for a session
async function loadStudents(session) {
  const studentsRef = collection(db, 'sessions', session);
  const querySnapshot = await getDocs(studentsRef);
  
  const students = [];
  querySnapshot.forEach((doc) => {
    students.push({
      id: doc.id,  // Parent phone number
      ...doc.data()
    });
  });
  
  // Sort by registration date (newest first)
  students.sort((a, b) => b.registeredAt.toMillis() - a.registeredAt.toMillis());
  
  return students;
}

// Render students table
async function renderStudentsTable(session) {
  const students = await loadStudents(session);
  const container = document.getElementById(`${session}Students`);
  
  // Update count
  document.getElementById(`${session}Count`).textContent = students.length;
  
  if (students.length === 0) {
    container.innerHTML = `
      <div class="alert alert-info mt-3">
        <i class="bi bi-info-circle"></i> No students registered for ${session} session yet.
      </div>
    `;
    return;
  }
  
  // Build table
  let tableHTML = `
    <div class="table-responsive mt-3">
      <table class="table table-hover table-striped">
        <thead class="table-dark">
          <tr>
            <th>#</th>
            <th>Student Name</th>
            <th>Parent Phone</th>
            <th>Class</th>
            <th>Subjects</th>
            <th>Payment Receipt</th>
            <th>Registered</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  students.forEach((student, index) => {
    const regDate = student.registeredAt.toDate().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    tableHTML += `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${student.studentName}</strong></td>
        <td>${student.parentPhone}</td>
        <td>${student.class}</td>
        <td><small>${student.subjects}</small></td>
        <td><small class="text-muted">${student.receiptMessage}</small></td>
        <td><small>${regDate}</small></td>
        <td>
          <button class="btn btn-sm btn-danger" 
                  onclick="deleteStudent('${session}', '${student.id}', '${student.studentName}')">
            <i class="bi bi-trash"></i> Delete
          </button>
        </td>
      </tr>
    `;
  });
  
  tableHTML += `
        </tbody>
      </table>
    </div>
  `;
  
  container.innerHTML = tableHTML;
}
```

#### Student Table Display (Populated)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Morning Session (47)  │  Evening Session (32)                                   │
├──────────────────────────────────────────────────────────────────────────────────┤
│  #  │ Student Name  │ Parent Phone │ Class  │ Subjects      │ Payment Receipt   │
├─────┼───────────────┼──────────────┼────────┼───────────────┼───────────────────┤
│ 1   │ John Doe      │ 0712345678   │ Form 2 │ Math, Physics │ M-Pesa XYZ789     │
│     │               │              │        │               │ Paid: Oct 20      │
│     │               │              │        │               │          [Delete] │
├─────┼───────────────┼──────────────┼────────┼───────────────┼───────────────────┤
│ 2   │ Mary Smith    │ 0723456789   │ Form 3 │ Chem, Bio     │ Bank Ref: 123ABC  │
│     │               │              │        │               │ Paid: Oct 20      │
│     │               │              │        │               │          [Delete] │
├─────┼───────────────┼──────────────┼────────┼───────────────┼───────────────────┤
│ 3   │ Peter Kamau   │ 0734567890   │ Form 1 │ All subjects  │ Cash payment      │
│     │               │              │        │               │ Verified: Oct 19  │
│     │               │              │        │               │          [Delete] │
└─────┴───────────────┴──────────────┴────────┴───────────────┴───────────────────┘
```

---

### 5.6 Deleting Students

#### Delete Flow

**Scenario:** Teacher needs to remove student who hasn't paid

**User Action:**
1. Teacher finds student "Jane Doe" in table
2. Clicks **[Delete]** button

**Confirmation Modal:**
```
┌─────────────────────────────────────┐
│  Delete Student                     │
├─────────────────────────────────────┤
│                                     │
│  Are you sure you want to delete    │
│  Jane Doe from Morning session?     │
│                                     │
│  Parent Phone: 0745678901           │
│                                     │
│  This action cannot be undone. The  │
│  student will need to register      │
│  again to rejoin.                   │
│                                     │
│     [Cancel]     [Yes, Delete]      │
└─────────────────────────────────────┘
```

**Code Implementation:**
```javascript
async function deleteStudent(session, phoneNumber, studentName) {
  // Show confirmation modal
  const confirmed = await showConfirmModal(
    'Delete Student',
    `Are you sure you want to delete ${studentName} from ${session} session?`,
    `Parent Phone: ${phoneNumber}`,
    'This action cannot be undone. The student will need to register again to rejoin.'
  );
  
  if (!confirmed) return;
  
  try {
    // Show loading state
    showLoadingToast('Deleting student...');
    
    // Delete from Firebase
    const docRef = doc(db, 'sessions', session, phoneNumber);
    await deleteDoc(docRef);
    
    // Success feedback
    hideLoadingToast();
    showSuccessToast(`✓ ${studentName} deleted successfully`);
    
    // Refresh table
    await renderStudentsTable(session);
    
  } catch (error) {
    console.error('Error deleting student:', error);
    hideLoadingToast();
    showErrorToast('Failed to delete student. Please try again.');
  }
}
```

**After Deletion:**
```
Student row disappears from table
Count updates: "Morning Session (46)" [was 47]
Success toast appears: "✓ Jane Doe deleted successfully"
```

**Result:**
- If Jane tries to join with phone `0745678901`, she'll see registration form (new student)
- Teacher can re-review payment and decide to keep/delete again

---

### 5.7 Additional Dashboard Features

#### Search & Filter (Optional Enhancement)

```html
<div class="mb-3">
  <input type="text" class="form-control" id="searchStudents" 
         placeholder="🔍 Search by name, phone, or class...">
</div>
```

```javascript
// Real-time search
document.getElementById('searchStudents').addEventListener('input', (e) => {
  const searchTerm = e.target.value.toLowerCase();
  const rows = document.querySelectorAll('#morningStudents tbody tr');
  
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(searchTerm) ? '' : 'none';
  });
});
```

#### Export to CSV (Optional Enhancement)

```javascript
function exportToCSV(session) {
  const students = await loadStudents(session);
  
  // Build CSV
  let csv = 'Student Name,Parent Phone,Class,Subjects,Payment Receipt,Registered At\n';
  students.forEach(student => {
    csv += `"${student.studentName}","${student.parentPhone}","${student.class}",`;
    csv += `"${student.subjects}","${student.receiptMessage}","${student.registeredAt.toDate()}"\n`;
  });
  
  // Download
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${session}-students-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}
```

---

## 6. Student Registration - Complete Flow {#student-registration}

### 6.1 URL Structure & Routing

```
Morning Session: https://yoursite.com/morning.html
Evening Session: https://yoursite.com/evening.html

OR (with URL parameters):
https://yoursite.com/register.html?session=morning
https://yoursite.com/register.html?session=evening
```

**

Recommended Approach:** Separate HTML files for clarity
javascript

// morning.html and evening.html both include same logic
// but with session variable set differently

// morning.html
<script>
  const SESSION = 'morning';
</script>
<script src="js/student-app.js"></script>

// evening.html
<script>
  const SESSION = 'evening';
</script>
<script src="js/student-app.js"></script>

6.2 Page Load & Initial State
Landing Page UI (Check-in Screen)
html

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Morning Session Registration</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
  <div class="container">
    <div class="row justify-content-center min-vh-100 align-items-center">
      <div class="col-md-6 col-lg-5">
        
        <!-- Header -->
        <div class="text-center mb-4">
          <div class="session-badge morning-badge mb-3">
            🌅 Morning Session
          </div>
          <h2 class="fw-bold">Welcome to Class</h2>
          <p class="text-muted">Enter your parent's phone number to continue</p>
        </div>
        
        <!-- Check-in Form -->
        <div class="card shadow-sm" id="checkinCard">
          <div class="card-body p-4">
            <form id="checkinForm">
              <div class="mb-3">
                <label for="parentPhone" class="form-label fw-semibold">
                  Parent's Phone Number <span class="text-danger">*</span>
                </label>
                <input 
                  type="tel" 
                  class="form-control form-control-lg" 
                  id="parentPhone" 
                  placeholder="e.g., 0712345678"
                  required
                  pattern="[0-9]{10}"
                  maxlength="10"
                >
                <div class="form-text">
                  Enter 10-digit phone number (e.g., 0712345678)
                </div>
                <div class="invalid-feedback" id="phoneError">
                  Please enter a valid 10-digit phone number
                </div>
              </div>
              
              <button type="submit" class="btn btn-primary btn-lg w-100" id="continueBtn">
                Continue
                <i class="bi bi-arrow-right ms-2"></i>
              </button>
            </form>
          </div>
        </div>
        
        <!-- Registration Form (Hidden Initially) -->
        <div class="card shadow-sm d-none" id="registrationCard">
          <div class="card-body p-4">
            <!-- Will be populated dynamically -->
          </div>
        </div>
        
        <!-- Welcome Back Screen (Hidden Initially) -->
        <div class="card shadow-sm d-none" id="welcomeCard">
          <div class="card-body p-4 text-center">
            <!-- Will be populated dynamically -->
          </div>
        </div>
        
      </div>
    </div>
  </div>
  
  <script type="module" src="js/firebase-config.js"></script>
  <script type="module" src="js/student-app.js"></script>
</body>
</html>

CSS Styling (styles.css)
css

/* Session Badges */
.session-badge {
  display: inline-block;
  padding: 8px 20px;
  border-radius: 20px;
  font-weight: 600;
  font-size: 0.9rem;
}

.morning-badge {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.evening-badge {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
}

/* Card Animations */
.card {
  border: none;
  border-radius: 15px;
  transition: all 0.3s ease;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 30px rgba(0,0,0,0.1) !important;
}

/* Form Inputs */
.form-control:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 0.2rem rgba(102, 126, 234, 0.25);
}

/* Buttons */
.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  transition: all 0.3s ease;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
}

/* Loading States */
.spinner-border-sm {
  width: 1rem;
  height: 1rem;
  border-width: 0.15em;
}

/* Success Animation */
@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.slide-in-up {
  animation: slideInUp 0.5s ease;
}

/* Mobile Responsiveness */
@media (max-width: 768px) {
  .container {
    padding: 15px;
  }
  
  .card-body {
    padding: 1.5rem !important;
  }
}

6.3 Phone Number Check Flow
Step 1: User Enters Phone Number

User Action:

    Types: 0712345678
    Clicks "Continue" button

Client-Side Validation:
javascript

// student-app.js
document.getElementById('checkinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const phoneInput = document.getElementById('parentPhone');
  const phone = phoneInput.value.trim();
  
  // Validate phone number format
  if (!validatePhoneNumber(phone)) {
    phoneInput.classList.add('is-invalid');
    document.getElementById('phoneError').textContent = 'Please enter a valid 10-digit phone number';
    return;
  }
  
  phoneInput.classList.remove('is-invalid');
  
  // Proceed to check registration
  await checkRegistration(phone);
});

function validatePhoneNumber(phone) {
  // Kenyan phone format: 10 digits starting with 0
  const phoneRegex = /^0[17]\d{8}$/;
  return phoneRegex.test(phone);
}
```

**Validation Rules:**
- Must be exactly 10 digits
- Must start with `0`
- Second digit should be `7` or `1` (Kenyan mobile format)
- Only numbers allowed
- No spaces, dashes, or special characters

**Error States:**
```
Empty field:
[                    ]
❌ Please enter a phone number

Invalid format (letters):
[071234abcd          ]
❌ Please enter a valid 10-digit phone number

Invalid format (too short):
[0712345             ]
❌ Please enter a valid 10-digit phone number

Invalid format (doesn't start with 0):
[712345678           ]
❌ Phone number must start with 0

Valid:
[0712345678          ] ✓

Step 2: Query Firebase for Existing Registration
javascript

async function checkRegistration(phone) {
  const continueBtn = document.getElementById('continueBtn');
  
  // Show loading state
  continueBtn.disabled = true;
  continueBtn.innerHTML = `
    <span class="spinner-border spinner-border-sm me-2"></span>
    Checking registration...
  `;
  
  try {
    // Query Firebase
    const docRef = doc(db, 'sessions', SESSION, phone);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      // Returning student - show welcome screen
      const studentData = docSnap.data();
      showWelcomeScreen(studentData);
    } else {
      // New student - show registration form
      showRegistrationForm(phone);
    }
    
  } catch (error) {
    console.error('Error checking registration:', error);
    
    // Reset button
    continueBtn.disabled = false;
    continueBtn.innerHTML = 'Continue <i class="bi bi-arrow-right ms-2"></i>';
    
    // Show error message
    showErrorAlert('Unable to check registration. Please check your connection and try again.');
  }
}
```

**Loading State UI:**
```
┌────────────────────────────────────┐
│  Parent's Phone Number             │
│  [0712345678                    ]  │
│                                    │
│  [⟳ Checking registration...    ] │
│  (Button disabled, shows spinner)  │
└────────────────────────────────────┘

6.4 New Student Flow - Registration Form
Step 3A: Show Registration Form (New Student)

Code Implementation:
javascript

function showRegistrationForm(phone) {
  // Hide check-in card
  document.getElementById('checkinCard').classList.add('d-none');
  
  // Show registration card
  const registrationCard = document.getElementById('registrationCard');
  registrationCard.classList.remove('d-none');
  registrationCard.classList.add('slide-in-up');
  
  // Build registration form
  registrationCard.querySelector('.card-body').innerHTML = `
    <div class="text-center mb-4">
      <h4 class="fw-bold">Complete Your Registration</h4>
      <p class="text-muted">Fill in your details to join the class</p>
    </div>
    
    <form id="registrationForm">
      
      <!-- Parent Phone (Read-only) -->
      <div class="mb-3">
        <label for="regParentPhone" class="form-label fw-semibold">
          Parent's Phone Number
        </label>
        <input 
          type="tel" 
          class="form-control" 
          id="regParentPhone" 
          value="${phone}"
          readonly
          disabled
        >
        <div class="form-text">
          <i class="bi bi-check-circle-fill text-success"></i> Verified
        </div>
      </div>
      
      <!-- Student Name -->
      <div class="mb-3">
        <label for="studentName" class="form-label fw-semibold">
          Student's Full Name <span class="text-danger">*</span>
        </label>
        <input 
          type="text" 
          class="form-control" 
          id="studentName" 
          placeholder="e.g., John Doe"
          required
          maxlength="100"
        >
        <div class="invalid-feedback">
          Please enter the student's name
        </div>
      </div>
      
      <!-- Class -->
      <div class="mb-3">
        <label for="studentClass" class="form-label fw-semibold">
          Class/Form <span class="text-danger">*</span>
        </label>
        <select class="form-select" id="studentClass" required>
          <option value="">Select class...</option>
          <option value="Form 1">Form 1</option>
          <option value="Form 2">Form 2</option>
          <option value="Form 3">Form 3</option>
          <option value="Form 4">Form 4</option>
        </select>
        <div class="invalid-feedback">
          Please select a class
        </div>
      </div>
      
      <!-- Subjects -->
      <div class="mb-3">
        <label for="subjects" class="form-label fw-semibold">
          Subjects <span class="text-danger">*</span>
        </label>
        <input 
          type="text" 
          class="form-control" 
          id="subjects" 
          placeholder="e.g., Mathematics, Physics, Chemistry"
          required
          maxlength="200"
        >
        <div class="form-text">
          Enter subjects separated by commas
        </div>
        <div class="invalid-feedback">
          Please enter at least one subject
        </div>
      </div>
      
      <!-- Payment Receipt -->
      <div class="mb-4">
        <label for="receiptMessage" class="form-label fw-semibold">
          Payment Receipt/Details <span class="text-danger">*</span>
        </label>
        <textarea 
          class="form-control" 
          id="receiptMessage" 
          rows="3"
          placeholder="e.g., M-Pesa Transaction: XYZ123456&#10;Amount: KES 5000&#10;Date: Oct 20, 2025"
          required
          maxlength="500"
        ></textarea>
        <div class="form-text">
          Enter payment reference number, method, and any relevant details
        </div>
        <div class="invalid-feedback">
          Please provide payment details
        </div>
      </div>
      
      <!-- Submit Button -->
      <button type="submit" class="btn btn-primary btn-lg w-100" id="registerBtn">
        Register & Join Class
        <i class="bi bi-box-arrow-in-right ms-2"></i>
      </button>
      
      <!-- Back Button -->
      <button type="button" class="btn btn-link w-100 mt-2" onclick="goBack()">
        <i class="bi bi-arrow-left me-2"></i>
        Use different phone number
      </button>
      
    </form>
  `;
  
  // Add form submission handler
  document.getElementById('registrationForm').addEventListener('submit', handleRegistration);
  
  // Auto-focus on first input
  setTimeout(() => {
    document.getElementById('studentName').focus();
  }, 300);
}

function goBack() {
  // Hide registration card
  document.getElementById('registrationCard').classList.add('d-none');
  
  // Show check-in card
  document.getElementById('checkinCard').classList.remove('d-none');
  
  // Reset phone input
  document.getElementById('parentPhone').value = '';
  document.getElementById('parentPhone').focus();
  
  // Reset continue button
  const continueBtn = document.getElementById('continueBtn');
  continueBtn.disabled = false;
  continueBtn.innerHTML = 'Continue <i class="bi bi-arrow-right ms-2"></i>';
}
```

**Registration Form UI:**
```
┌──────────────────────────────────────────────┐
│       Complete Your Registration              │
│   Fill in your details to join the class     │
├──────────────────────────────────────────────┤
│                                               │
│  Parent's Phone Number                        │
│  [0712345678               ] (greyed out)     │
│  ✓ Verified                                   │
│                                               │
│  Student's Full Name *                        │
│  [_____________________________]              │
│                                               │
│  Class/Form *                                 │
│  [Select class...           ▼]                │
│                                               │
│  Subjects *                                   │
│  [_____________________________]              │
│  Enter subjects separated by commas           │
│                                               │
│  Payment Receipt/Details *                    │
│  [_____________________________]              │
│  [_____________________________]              │
│  [_____________________________]              │
│  Enter payment reference number, method...    │
│                                               │
│  [   Register & Join Class →   ]              │
│                                               │
│  ← Use different phone number                 │
└──────────────────────────────────────────────┘

Step 4: Form Validation & Submission

Real-Time Validation:
javascript

// Add real-time validation to inputs
document.getElementById('studentName').addEventListener('blur', function() {
  if (this.value.trim().length < 2) {
    this.classList.add('is-invalid');
  } else {
    this.classList.remove('is-invalid');
    this.classList.add('is-valid');
  }
});

document.getElementById('subjects').addEventListener('blur', function() {
  if (this.value.trim().length < 3) {
    this.classList.add('is-invalid');
  } else {
    this.classList.remove('is-invalid');
    this.classList.add('is-valid');
  }
});

document.getElementById('receiptMessage').addEventListener('blur', function() {
  if (this.value.trim().length < 10) {
    this.classList.add('is-invalid');
  } else {
    this.classList.remove('is-invalid');
    this.classList.add('is-valid');
  }
});

Form Submission Handler:
javascript

async function handleRegistration(e) {
  e.preventDefault();
  
  const form = e.target;
  
  // Get all values
  const registrationData = {
    parentPhone: document.getElementById('regParentPhone').value,
    studentName: document.getElementById('studentName').value.trim(),
    class: document.getElementById('studentClass').value,
    subjects: document.getElementById('subjects').value.trim(),
    receiptMessage: document.getElementById('receiptMessage').value.trim()
  };
  
  // Validate all fields
  if (!form.checkValidity()) {
    form.classList.add('was-validated');
    return;
  }
  
  // Additional validation
  if (registrationData.studentName.length < 2) {
    showErrorAlert('Please enter a valid student name');
    return;
  }
  
  if (registrationData.subjects.length < 3) {
    showErrorAlert('Please enter at least one subject');
    return;
  }
  
  if (registrationData.receiptMessage.length < 10) {
    showErrorAlert('Please provide more detailed payment information');
    return;
  }
  
  // Show loading state
  const registerBtn = document.getElementById('registerBtn');
  registerBtn.disabled = true;
  registerBtn.innerHTML = `
    <span class="spinner-border spinner-border-sm me-2"></span>
    Registering...
  `;
  
  try {
    // Save to Firebase
    await saveRegistration(registrationData);
    
    // Success - redirect to Zoom
    await redirectToZoom();
    
  } catch (error) {
    console.error('Registration error:', error);
    
    // Reset button
    registerBtn.disabled = false;
    registerBtn.innerHTML = 'Register & Join Class <i class="bi bi-box-arrow-in-right ms-2"></i>';
    
    // Show error
    if (error.code === 'permission-denied') {
      showErrorAlert('Registration failed. You may already be registered. Please refresh and try again.');
    } else if (error.code === 'unavailable') {
      showErrorAlert('Connection error. Please check your internet and try again.');
    } else {
      showErrorAlert('Registration failed. Please try again.');
    }
  }
}

Save to Firebase:
javascript

async function saveRegistration(data) {
  const docRef = doc(db, 'sessions', SESSION, data.parentPhone);
  
  // Prepare document data
  const registrationDoc = {
    studentName: data.studentName,
    parentPhone: data.parentPhone,
    class: data.class,
    subjects: data.subjects,
    receiptMessage: data.receiptMessage,
    registeredAt: serverTimestamp(),
    lastAccessed: serverTimestamp(),
    session: SESSION
  };
  
  // Save to Firestore
  await setDoc(docRef, registrationDoc);
  
  console.log('Registration successful:', data.parentPhone);
}

Step 5: Redirect to Zoom Class
javascript

async function redirectToZoom() {
  // Get Zoom link from Firebase config
  const configRef = doc(db, 'config', 'zoomLinks');
  const configSnap = await getDoc(configRef);
  
  if (!configSnap.exists()) {
    throw new Error('Zoom links not configured');
  }
  
  const zoomLink = configSnap.data()[SESSION];
  
  if (!zoomLink || zoomLink.trim() === '') {
    // No link set yet
    showSuccessMessage(
      'Registration Successful! ✓',
      'Your registration has been saved. The teacher will share the class link soon.',
      false
    );
    return;
  }
  
  // Show success message with redirect
  showSuccessMessage(
    'Registration Successful! ✓',
    'Redirecting you to the Zoom class...',
    true
  );
  
  // Redirect after 2 seconds
  setTimeout(() => {
    window.location.href = zoomLink;
  }, 2000);
}

function showSuccessMessage(title, message, willRedirect) {
  const registrationCard = document.getElementById('registrationCard');
  registrationCard.querySelector('.card-body').innerHTML = `
    <div class="text-center py-5">
      <div class="mb-4">
        <i class="bi bi-check-circle-fill text-success" style="font-size: 4rem;"></i>
      </div>
      <h3 class="fw-bold text-success mb-3">${title}</h3>
      <p class="text-muted mb-4">${message}</p>
      ${willRedirect ? `
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      ` : `
        <a href="/" class="btn btn-primary">
          Back to Home
        </a>
      `}
    </div>
  `;
}
```

**Success Screen UI:**
```
┌──────────────────────────────────────┐
│                                       │
│           ✓ (Large checkmark)         │
│                                       │
│   Registration Successful! ✓          │
│                                       │
│   Redirecting you to the Zoom class...│
│                                       │
│           ⟳ (Loading spinner)         │
│                                       │
└──────────────────────────────────────┘

[After 2 seconds: Browser redirects to Zoom URL]

6.5 Zoom Redirect Behavior

What Happens:

    Browser navigates to: https://zoom.us/j/123456789?pwd=abc123
    On Desktop:
        Zoom desktop app opens automatically (if installed)
        OR browser shows "Open Zoom Meetings?" dialog
        User joins meeting
    On Mobile:
        Zoom mobile app opens (if installed)
        OR redirects to App Store/Play Store to install Zoom
        User returns and joins meeting

Teacher's Zoom View:

    Student appears in waiting room (if enabled)
    Teacher sees: "John Doe's iPad is waiting to join"
    Teacher clicks "Admit"
    Student enters class

7. Returning Student Flow {#returning-student}
7.1 Recognition & Welcome Screen
Scenario: Student Used Same Phone Before

User Action:

    Student clicks morning link again (next day)
    Enters same phone: 0712345678
    Clicks Continue

Firebase Query Result:
javascript

// Document exists at /sessions/morning/0712345678
{
  studentName: "John Doe",
  parentPhone: "0712345678",
  class: "Form 2",
  subjects: "Math, Physics",
  receiptMessage: "M-Pesa XYZ789",
  registeredAt: Timestamp(Oct 20, 2025 14:30),
  lastAccessed: Timestamp(Oct 21, 2025 08:15)
}

Code Implementation:
javascript

function showWelcomeScreen(studentData) {
  // Hide check-in card
  document.getElementById('checkinCard').classList.add('d-none');
  
  // Show welcome card
  const welcomeCard = document.getElementById('welcomeCard');
  welcomeCard.classList.remove('d-none');
  welcomeCard.classList.add('slide-in-up');
  
  welcomeCard.querySelector('.card-body').innerHTML = `
    <div class="py-4">
      <!-- Welcome Icon -->
      <div class="mb-4">
        <i class="bi bi-person-circle text-primary" style="font-size: 5rem;"></i>
      </div>
      
      <!-- Welcome Message -->
      <h3 class="fw-bold mb-2">Welcome Back, ${studentData.studentName}! 👋</h3>
      <p class="text-muted mb-4">
        We found your registration for ${SESSION} session
      </p>
      
      <!-- Student Details -->
      <div class="text-start bg-light p-3 rounded mb-4">
        <div class="mb-2">
          <small class="text-muted">Class:</small>
          <strong class="ms-2">${studentData.class}</strong>
        </div>
        <div class="mb-2">
          <small class="text-muted">Subjects:</small>
          <strong class="ms-2">${studentData.subjects}</strong>
        </div>
        <div>
          <small class="text-muted">Registered:</small>
          <strong class="ms-2">${formatDate(studentData.registeredAt)}</strong>
        </div>
      </div>
      
      <!-- Redirect Message -->
      <div class="alert alert-info mb-4">
        <i class="bi bi-info-circle me-2"></i>
        Redirecting you to class in <span id="countdown">3</span> seconds...
      </div>
      
      <!-- Loading Spinner -->
      <div class="spinner-border text-primary mb-3" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      
      <!-- Manual Join Button -->
      <button class="btn btn-outline-primary" onclick="joinNow()">
        Join Now (Don't Wait)
        <i class="bi bi-box-arrow-in-right ms-2"></i>
      </button>
      
      <!-- Back Link -->
      <div class="mt-3">
        <a href="javascript:goBack()" class="text-muted text-decoration-none">
          <i class="bi bi-arrow-left me-1"></i>
          Not you? Use different number
        </a>
      </div>
    </div>
  `;
  
  // Update last accessed timestamp
  updateLastAccessed(studentData.parentPhone);
  
  // Start countdown and redirect
  startCountdownRedirect();
}

function formatDate(timestamp) {
  const date = timestamp.toDate();
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

async function updateLastAccessed(phone) {
  try {
    const docRef = doc(db, 'sessions', SESSION, phone);
    await setDoc(docRef, {
      lastAccessed: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('Error updating last accessed:', error);
    // Non-critical, don't block user
  }
}

let countdownInterval;

function startCountdownRedirect() {
  let seconds = 3;
  const countdownEl = document.getElementById('countdown');
  
  countdownInterval = setInterval(() => {
    seconds--;
    if (countdownEl) {
      countdownEl.textContent = seconds;
    }
    
    if (seconds <= 0) {
      clearInterval(countdownInterval);
      joinNow();
    }
  }, 1000);
}

async function joinNow() {
  clearInterval(countdownInterval);
  await redirectToZoom();
}
```

**Welcome Screen UI:**
```
┌──────────────────────────────────────────┐
│                                           │
│        👤 (Large person icon)             │
│                                           │
│   Welcome Back, John Doe! 👋              │
│                                           │
│   We found your registration for          │
│   morning session                         │
│                                           │
│  ┌─────────────────────────────────────┐ │
│  │ Class: Form 2                       │ │
│  │ Subjects: Math, Physics             │ │
│  │ Registered: 20 Oct 2025             │ │
│  └─────────────────────────────────────┘ │
│                                           │
│  ℹ️ Redirecting you to class in 2 seconds│
│                                           │
│           ⟳ (Loading spinner)             │
│                                           │
│  [   Join Now (Don't Wait) →   ]          │
│                                           │
│  ← Not you? Use different number          │
└──────────────────────────────────────────┘
```

**Timeline:**
```
T=0s:  Welcome screen appears
T=1s:  Countdown shows "2"
T=2s:  Countdown shows "1"
T=3s:  Automatic redirect to Zoom

OR: User clicks "Join Now" → Immediate redirect
```

---

### 7.2 Cross-Device Continuity

**Scenario:** Student registered on phone, now using laptop

**Flow:**
1. Student visits `yoursite.com/morning` on laptop
2. Enters parent phone: `0712345678`
3. System queries Firebase → Found!
4. Shows welcome screen → Redirects to Zoom
5. **Works perfectly** - no device cookies needed

**Why It Works:**
- Identity tied to phone number (in database)
- Not tied to browser cookies or localStorage
- Phone number is portable across all devices
- Parent phone unlikely to change

---

## 8. Session Switching {#session-switching}

### 8.1 Student Wants to Change Sessions

**Scenario:** John registered for morning, now wants evening

**Flow:**
1. Student clicks **evening link**: `yoursite.com/evening`
2. Enters phone: `0712345678`
3. System queries: `/sessions/evening/0712345678` → **Not Found**
4. Shows registration form (he's new to evening session)
5. Student fills form → Registers for evening
6. **Result:** Student now in both morning AND evening collections

**Firebase After Switch:**
```
/sessions
  /morning
    /0712345678
      - studentName: "John Doe"
      - class: "Form 2"
      - ...
  /evening
    /0712345678
      - studentName: "John Doe"
      - class: "Form 2"
      - ...

Important:

    Each session is independent
    Student can be in both sessions
    Teacher manages each session separately
    If teacher deletes from morning, evening registration remains

8.2 Teacher Moves Student Between Sessions

Scenario: Teacher wants to move Jane from morning to evening

Manual Process:

    Teacher opens dashboard
    Goes to "Morning Students" tab
    Finds Jane, clicks [Delete]
    Jane's phone: 0745678901 removed from morning
    Teacher tells Jane: "Use the evening link to re-register"
    Jane clicks evening link → Re-registers → Now in evening only

Why No Automatic Transfer:

    Keeps system simple
    Teachers maintain control
    Student can verify new session details
    Payment receipt can be updated if needed

9. UI/UX Design Specifications {#uiux-design}
9.1 Color Palette

Colors */
:root {
  /* Primary Brand Colors */
  --primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --primary-color: #667eea;
  --primary-dark: #5568d3;
  --primary-light: #8b9cff;
  
  /* Session Colors */
  --morning-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --morning-color: #667eea;
  --evening-gradient: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  --evening-color: #f093fb;
  
  /* Status Colors */
  --success-color: #10b981;
  --success-light: #d1fae5;
  --error-color: #ef4444;
  --error-light: #fee2e2;
  --warning-color: #f59e0b;
  --warning-light: #fef3c7;
  --info-color: #3b82f6;
  --info-light: #dbeafe;
  
  /* Neutral Colors */
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --bg-primary: #ffffff;
  --bg-secondary: #f9fafb;
  --bg-tertiary: #f3f4f6;
  --border-color: #e5e7eb;
  
  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  
  /* Border Radius */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  
  /* Spacing */
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2rem;
  --spacing-2xl: 3rem;
  
  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-base: 250ms ease;
  --transition-slow: 350ms ease;
}
```

---

### 9.2 Typography

```css
/* Font Import */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 16px;
  line-height: 1.5;
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Headings */
h1, h2, h3, h4, h5, h6 {
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: var(--spacing-md);
  color: var(--text-primary);
}

h1 { font-size: 2.5rem; }
h2 { font-size: 2rem; }
h3 { font-size: 1.75rem; }
h4 { font-size: 1.5rem; }
h5 { font-size: 1.25rem; }
h6 { font-size: 1rem; }

/* Body Text */
p {
  margin-bottom: var(--spacing-md);
  color: var(--text-secondary);
}

.text-muted {
  color: var(--text-muted) !important;
}

/* Labels */
label {
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--text-primary);
  margin-bottom: var(--spacing-xs);
}

/* Form Text / Helper Text */
.form-text {
  font-size: 0.8125rem;
  color: var(--text-muted);
  margin-top: var(--spacing-xs);
}

/* Small Text */
small {
  font-size: 0.875rem;
  color: var(--text-secondary);
}
```

---

### 9.3 Button Styles

```css
/* Base Button Styles */
.btn {
  font-weight: 600;
  border-radius: var(--radius-md);
  padding: 0.625rem 1.25rem;
  transition: all var(--transition-base);
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 1rem;
}

.btn:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.3);
}

/* Primary Button */
.btn-primary {
  background: var(--primary-gradient);
  color: white;
  border: none;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(102, 126, 234, 0.35);
}

.btn-primary:active {
  transform: translateY(0);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* Success Button */
.btn-success {
  background: var(--success-color);
  color: white;
}

.btn-success:hover {
  background: #059669;
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.35);
}

/* Danger Button */
.btn-danger {
  background: var(--error-color);
  color: white;
}

.btn-danger:hover {
  background: #dc2626;
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(239, 68, 68, 0.35);
}

/* Outline Button */
.btn-outline-primary {
  background: transparent;
  color: var(--primary-color);
  border: 2px solid var(--primary-color);
}

.btn-outline-primary:hover {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

/* Link Button */
.btn-link {
  background: transparent;
  color: var(--primary-color);
  text-decoration: none;
  padding: 0.5rem;
}

.btn-link:hover {
  color: var(--primary-dark);
  text-decoration: underline;
}

/* Button Sizes */
.btn-sm {
  padding: 0.375rem 0.875rem;
  font-size: 0.875rem;
}

.btn-lg {
  padding: 0.875rem 1.5rem;
  font-size: 1.125rem;
}

/* Loading State */
.btn .spinner-border {
  width: 1rem;
  height: 1rem;
  border-width: 0.15em;
}
```

---

### 9.4 Form Input Styles

```css
/* Form Controls */
.form-control,
.form-select {
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  font-size: 1rem;
  transition: all var(--transition-fast);
  background: var(--bg-primary);
  color: var(--text-primary);
}

.form-control:focus,
.form-select:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  outline: none;
}

/* Large Inputs */
.form-control-lg {
  padding: 1rem 1.25rem;
  font-size: 1.125rem;
  border-radius: var(--radius-lg);
}

/* Validation States */
.form-control.is-valid,
.form-select.is-valid {
  border-color: var(--success-color);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2310b981'%3E%3Cpath fill-rule='evenodd' d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z' clip-rule='evenodd'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1.25rem;
  padding-right: 3rem;
}

.form-control.is-invalid,
.form-select.is-invalid {
  border-color: var(--error-color);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23ef4444'%3E%3Cpath fill-rule='evenodd' d='M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z' clip-rule='evenodd'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1.25rem;
  padding-right: 3rem;
}

/* Disabled State */
.form-control:disabled,
.form-select:disabled {
  background-color: var(--bg-tertiary);
  color: var(--text-muted);
  cursor: not-allowed;
  opacity: 0.7;
}

/* Textarea */
textarea.form-control {
  resize: vertical;
  min-height: 100px;
}

/* Feedback Messages */
.invalid-feedback,
.valid-feedback {
  display: none;
  margin-top: var(--spacing-xs);
  font-size: 0.875rem;
  font-weight: 500;
}

.was-validated .form-control:invalid ~ .invalid-feedback,
.form-control.is-invalid ~ .invalid-feedback {
  display: block;
  color: var(--error-color);
}

.was-validated .form-control:valid ~ .valid-feedback,
.form-control.is-valid ~ .valid-feedback {
  display: block;
  color: var(--success-color);
}
```

---

### 9.5 Card Styles

```css
/* Card Component */
.card {
  background: var(--bg-primary);
  border: none;
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
  transition: all var(--transition-base);
  overflow: hidden;
}

.card:hover {
  box-shadow: var(--shadow-lg);
}

.card-body {
  padding: var(--spacing-xl);
}

/* Card with Gradient Border */
.card-gradient-border {
  position: relative;
  background: white;
  border-radius: var(--radius-xl);
}

.card-gradient-border::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--radius-xl);
  padding: 2px;
  background: var(--primary-gradient);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

/* Session Badge on Card */
.card .session-badge {
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
}
```

---

### 9.6 Alert & Toast Styles

```css
/* Alert Component */
.alert {
  border: none;
  border-radius: var(--radius-lg);
  padding: var(--spacing-md) var(--spacing-lg);
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: 0.9375rem;
  font-weight: 500;
}

.alert-success {
  background: var(--success-light);
  color: #065f46;
}

.alert-danger,
.alert-error {
  background: var(--error-light);
  color: #991b1b;
}

.alert-warning {
  background: var(--warning-light);
  color: #92400e;
}

.alert-info {
  background: var(--info-light);
  color: #1e40af;
}

/* Toast Notifications */
.toast-container {
  position: fixed;
  top: var(--spacing-xl);
  right: var(--spacing-xl);
  z-index: 9999;
  max-width: 400px;
}

.toast {
  background: white;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  padding: var(--spacing-md) var(--spacing-lg);
  margin-bottom: var(--spacing-sm);
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  animation: slideInRight 0.3s ease;
  border-left: 4px solid var(--primary-color);
}

.toast-success {
  border-left-color: var(--success-color);
}

.toast-error {
  border-left-color: var(--error-color);
}

.toast-warning {
  border-left-color: var(--warning-color);
}

.toast-info {
  border-left-color: var(--info-color);
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(100px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.toast-icon {
  font-size: 1.5rem;
}

.toast-content {
  flex: 1;
}

.toast-title {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.toast-message {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.toast-close {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  font-size: 1.25rem;
  line-height: 1;
  opacity: 0.6;
  transition: opacity var(--transition-fast);
}

.toast-close:hover {
  opacity: 1;
}
```

**Toast Implementation:**
```javascript
// Toast notification system
function showToast(type, title, message, duration = 5000) {
  const toastContainer = document.getElementById('toastContainer') || createToastContainer();
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  
  toast.innerHTML = `
    <div class="toast-icon">${icons[type]}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  toastContainer.appendChild(toast);
  
  // Auto-remove after duration
  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toastContainer';
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

// Helper functions
function showSuccessToast(message) {
  showToast('success', 'Success', message);
}

function showErrorToast(message) {
  showToast('error', 'Error', message);
}

function showWarningToast(message) {
  showToast('warning', 'Warning', message);
}

function showInfoToast(message) {
  showToast('info', 'Info', message);
}
```

---

### 9.7 Modal Styles

```css
/* Modal Overlay */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-md);
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Modal Container */
.modal-container {
  background: white;
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 100%;
  animation: scaleIn 0.3s ease;
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Modal Header */
.modal-header {
  padding: var(--spacing-lg) var(--spacing-xl);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.modal-close {
  background: transparent;
  border: none;
  font-size: 1.5rem;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.modal-close:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

/* Modal Body */
.modal-body {
  padding: var(--spacing-xl);
}

/* Modal Footer */
.modal-footer {
  padding: var(--spacing-lg) var(--spacing-xl);
  border-top: 1px solid var(--border-color);
  display: flex;
  gap: var(--spacing-md);
  justify-content: flex-end;
}

/* Confirmation Modal Specific */
.modal-icon {
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto var(--spacing-lg);
  font-size: 2rem;
}

.modal-icon.warning {
  background: var(--warning-light);
  color: var(--warning-color);
}

.modal-icon.danger {
  background: var(--error-light);
  color: var(--error-color);
}

.modal-icon.info {
  background: var(--info-light);
  color: var(--info-color);
}
```

**Confirmation Modal Implementation:**
```javascript
// Confirmation modal system
function showConfirmModal(title, message, details = '', warning = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    overlay.innerHTML = `
      <div class="modal-container">
        <div class="modal-header">
          <h5 class="modal-title">${title}</h5>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove(); window.modalResolve(false);">×</button>
        </div>
        <div class="modal-body text-center">
          <div class="modal-icon danger">
            <i class="bi bi-exclamation-triangle"></i>
          </div>
          <p class="mb-3">${message}</p>
          ${details ? `<p class="text-muted mb-3"><small>${details}</small></p>` : ''}
          ${warning ? `<div class="alert alert-warning">${warning}</div>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline-secondary" onclick="this.closest('.modal-overlay').remove(); window.modalResolve(false);">
            Cancel
          </button>
          <button class="btn btn-danger" onclick="this.closest('.modal-overlay').remove(); window.modalResolve(true);">
            Confirm
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Store resolve function globally for onclick handlers
    window.modalResolve = resolve;
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

// Usage example:
// const confirmed = await showConfirmModal('Delete Student', 'Are you sure?', 'Phone: 0712345678', 'This cannot be undone');
```

---

### 9.8 Loading States

```css
/* Loading Spinner */
.spinner-border {
  display: inline-block;
  width: 2rem;
  height: 2rem;
  border: 0.25em solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spinner-border 0.75s linear infinite;
}

@keyframes spinner-border {
  to { transform: rotate(360deg); }
}

.spinner-border-sm {
  width: 1rem;
  height: 1rem;
  border-width: 0.15em;
}

/* Loading Overlay for Entire Page */
.loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(4px);
  z-index: 9998;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-lg);
}

.loading-text {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-secondary);
}

/* Skeleton Loading (for tables) */
.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: loading 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}

@keyframes loading {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.skeleton-text {
  height: 1rem;
  margin-bottom: var(--spacing-sm);
}

.skeleton-text:last-child {
  width: 60%;
}

.skeleton-avatar {
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
}
```

**Loading Overlay Implementation:**
```javascript
function showLoadingOverlay(message = 'Loading...') {
  const overlay = document.createElement('div');
  overlay.id = 'loadingOverlay';
  overlay.className = 'loading-overlay';
  overlay.innerHTML = `
    <div class="spinner-border text-primary" style="width: 3rem; height: 3rem;"></div>
    <div class="loading-text">${message}</div>
  `;
  document.body.appendChild(overlay);
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.remove();
}
```

---

### 9.9 Responsive Design

```css
/* Mobile First Approach */

/* Small devices (phones, less than 768px) */
@media (max-width: 767px) {
  .container {
    padding: var(--spacing-md);
  }
  
  h1 { font-size: 2rem; }
  h2 { font-size: 1.75rem; }
  h3 { font-size: 1.5rem; }
  
  .card-body {
    padding: var(--spacing-lg) !important;
  }
  
  .btn-lg {
    padding: 0.75rem 1.25rem;
    font-size: 1rem;
  }
  
  /* Stack form labels and inputs */
  .form-label {
    margin-bottom: var(--spacing-sm);
  }
  
  /* Full width buttons on mobile */
  .modal-footer {
    flex-direction: column;
  }
  
  .modal-footer .btn {
    width: 100%;
  }
  
  /* Smaller toast on mobile */
  .toast-container {
    right: var(--spacing-sm);
    left: var(--spacing-sm);
    max-width: none;
  }
  
  /* Table responsive scroll */
  .table-responsive {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  table {
    font-size: 0.875rem;
  }
  
  td, th {
    padding: 0.5rem !important;
  }
}

/* Medium devices (tablets, 768px and up) */
@media (min-width: 768px) and (max-width: 991px) {
  .container {
    max-width: 720px;
  }
}

/* Large devices (desktops, 992px and up) */
@media (min-width: 992px) {
  .container {
    max-width: 960px;
  }
}

/* Extra large devices (large desktops, 1200px and up) */
@media (min-width: 1200px) {
  .container {
    max-width: 1140px;
  }
}

/* Print styles */
@media print {
  .btn, .modal-overlay, .toast-container {
    display: none !important;
  }
  
  .card {
    box-shadow: none !important;
    border: 1px solid #ddd !important;
  }
}
```

---

### 9.10 Accessibility Features

```css
/* Focus Visible (keyboard navigation) */
*:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

/* Skip to main content link */
.skip-to-main {
  position: absolute;
  left: -9999px;
  z-index: 999;
  padding: var(--spacing-md);
  background: var(--primary-color);
  color: white;
  text-decoration: none;
  border-radius: var(--radius-md);
}

.skip-to-main:focus {
  left: var(--spacing-md);
  top: var(--spacing-md);
}

/* Screen reader only content */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

/* High contrast mode support */
@media (prefers-contrast: high) {
  .btn {
    border: 2px solid currentColor;
  }
  
  .form-control,
  .form-select {
    border-width: 3px;
  }
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Dark mode support (optional enhancement) */
@media (prefers-color-scheme: dark) {
  :root {
    --text-primary: #f9fafb;
    --text-secondary: #d1d5db;
    --text-muted: #9ca3af;
    --bg-primary: #1f2937;
    --bg-secondary: #111827;
    --bg-tertiary: #374151;
    --border-color: #4b5563;
  }
  
  .card {
    background: var(--bg-primary);
    color: var(--text-primary);
  }
  
  .form-control,
  .form-select {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-color: var(--border-color);
  }
}
```

**HTML Accessibility Attributes:**
```html
<!-- ARIA labels for screen readers -->
<button aria-label="Close dialog">×</button>

<!-- ARIA live regions for dynamic updates -->
<div role="alert" aria-live="polite">Registration successful!</div>

<!-- Semantic HTML -->
<main role="main">
  <nav role="navigation" aria-label="Main navigation">
    ...
  </nav>
</main>

<!-- Form labels properly associated -->
<label for="studentName">Student Name</label>
<input type="text" id="studentName" aria-required="true" aria-describedby="nameHelp">

<div id="nameHelp" class="form-text">Enter student's full legal name</div>

<!-- Loading states announced to screen readers -->
<button aria-busy="true" aria-live="polite">
  <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
  <span class="sr-only">Loading, please wait</span>
  Saving...
</button>

<!-- Dialog modals -->
<div role="dialog" aria-modal="true" aria-labelledby="modalTitle">
  <h5 id="modalTitle">Confirm Deletion</h5>
  ...
</div>

<!-- Table captions for screen readers -->
<table>
  <caption class="sr-only">List of registered students for morning session</caption>
  <thead>...</thead>
  <tbody>...</tbody>
</table>
```

---

## 10. Technical Implementation Details {#technical-implementation}

### 10.1 Firebase Configuration

**firebase-config.js:**
```javascript
// Import Firebase SDKs
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// Firebase configuration (from Firebase Console)
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const db = getFirestore(app);
export const auth = getAuth(app);

// Export app for other uses
export default app;
```

---

### 10.2 Student Registration Complete Code

**student-app.js:**
```javascript
import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

// Session constant (set by individual HTML files)
// const SESSION = 'morning'; // or 'evening'

// DOM Elements
let parentPhoneInput, continueBtn, checkinCard, registrationCard, welcomeCard;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initializeElements();
  setupEventListeners();
});

function initializeElements() {
  parentPhoneInput = document.getElementById('parentPhone');
  continueBtn = document.getElementById('continueBtn');
  checkinCard = document.getElementById('checkinCard');
  registrationCard = document.getElementById('registrationCard');
  welcomeCard = document.getElementById('welcomeCard');
}

function setupEventListeners() {
  // Check-in form submission
  document.getElementById('checkinForm').addEventListener('submit', handleCheckin);
  
  // Auto-format phone number as user types
  parentPhoneInput.addEventListener('input', formatPhoneInput);
  
  // Real-time validation
  parentPhoneInput.addEventListener('blur', validatePhoneInput);
}

// ============================================
// PHONE NUMBER VALIDATION & FORMATTING
// ============================================

function formatPhoneInput(e) {
  let value = e.target.value.replace(/\D/g, ''); // Remove non-digits
  
  // Limit to 10 digits
  if (value.length > 10) {
    value = value.slice(0, 10);
  }
  
  e.target.value = value;
}

function validatePhoneInput() {
  const phone = parentPhoneInput.value.trim();
  
  if (phone === '') {
    parentPhoneInput.classList.remove('is-invalid', 'is-valid');
    return;
  }
  
  if (validatePhoneNumber(phone)) {
    parentPhoneInput.classList.remove('is-invalid');
    parentPhoneInput.classList.add('is-valid');
  } else {
    parentPhoneInput.classList.remove('is-valid');
    parentPhoneInput.classList.add('is-invalid');
  }
}

function validatePhoneNumber(phone) {
  // Kenyan mobile format: 10 digits starting with 07 or 01
  const phoneRegex = /^0[17]\d{8}$/;
  return phoneRegex.test(phone);
}

// ============================================
// CHECK-IN FLOW
// ============================================

async function handleCheckin(e) {
  e.preventDefault();
  
  const phone = parentPhoneInput.value.trim();
  
  // Validate
  if (!validatePhoneNumber(phone)) {
    parentPhoneInput.classList.add('is-invalid');
    document.getElementById('phoneError').textContent = 
      'Please enter a valid 10-digit phone number starting with 07 or 01';
    return;
  }
  
  parentPhoneInput.classList.remove('is-invalid');
  
  // Show loading
  setButtonLoading(continueBtn, true, 'Checking registration...');
  
  try {
    await checkRegistration(phone);
  } catch (error) {
    console.error('Error during check-in:', error);
    setButtonLoading(continueBtn, false);
    showErrorAlert('Unable to check registration. Please check your connection and try again.');
  }
}

async function checkRegistration(phone) {
  const docRef = doc(db, 'sessions', SESSION, phone);
  
  try {
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      // Returning student
      const studentData = docSnap.data();
      showWelcomeScreen(studentData);
    } else {
      // New student
      showRegistrationForm(phone);
    }
  } catch (error) {
    throw error;
  }
}

// ============================================
// REGISTRATION FORM (NEW STUDENT)
// ============================================

function showRegistrationForm(phone) {
  // Hide check-in
  checkinCard.classList.add('d-none');
  
  // Show registration
  registrationCard.classList.remove('d-none');
  registrationCard.classList.add('slide-in-up');
  
  // Build form HTML
  registrationCard.querySelector('.card-body').innerHTML = `
    <div class="text-center mb-4">
      <div class="session-badge ${SESSION}-badge mb-3">
        ${SESSION === 'morning' ? '🌅' : '🌙'} ${SESSION.charAt(0).toUpperCase() + SESSION.slice(1)} Session
      </div>
      <h4 class="fw-bold">Complete Your Registration</h4>
      <p class="text-muted">Fill in your details to join the class</p>
    </div>
    
    <form id="registrationForm" novalidate>
      
      <!-- Parent Phone (Read-only) -->
      <div class="mb-3">
        <label for="regParentPhone" class="form-label fw-semibold">
          Parent's Phone Number
        </label>
        <input 
          type="tel" 
          class="form-control" 
          id="regParentPhone" 
          value="${phone}"
          readonly
          disabled
        >
        <div class="form-text text-success">
          <i class="bi bi-check-circle-fill"></i> Verified
        </div>
      </div>
      
      <!-- Student Name -->
      <div class="mb-3">
        <label for="studentName" class="form-label fw-semibold">
          Student's Full Name <span class="text-danger">*</span>
        </label>
        <input 
          type="text" 
          class="form-control" 
          id="studentName" 
          placeholder="e.g., John Kamau Doe"
          required
          minlength="2"
          maxlength="100"
          autocomplete="name"
        >
        <div class="invalid-feedback">
          Please enter the student's full name (minimum 2 characters)
        </div>
      </div>
      
      <!-- Class -->
      <div class="mb-3">
        <label for="studentClass" class="form-label fw-semibold">
          Class/Form <span class="text-danger">*</span>
        </label>
        <select class="form-select" id="studentClass" required>
          <option value="">Select class...</option>
          <option value="Form 1">Form 1</option>
          <option value="Form 2">Form 2</option>
          <option value="Form 3">Form 3</option>
          <option value="Form 4">Form 4</option>
        </select>
        <div class="invalid-feedback">
          Please select a class
        </div>
      </div>
      
      <!-- Subjects -->
      <div class="mb-3">
        <label for="subjects" class="form-label fw-semibold">
          Subjects Enrolled <span class="text-danger">*</span>
        </label>
        <input 
          type="text" 
          class="form-control" 
          id="subjects" 
          placeholder="e.g., Mathematics, Physics, Chemistry, Biology"
          required
          minlength="3"
          maxlength="200"
        >
        <div class="form-text">
          Enter subjects separated by commas
        </div>
        <div class="invalid-feedback">
          Please enter at least one subject
        </div>
      </div>
      
      <!-- Payment Receipt -->
      <div class="mb-4">
        <label for="receiptMessage" class="form-label fw-semibold">
          Payment Receipt/Details <span class="text-danger">*</span>
        </label>
        <textarea 
          class="form-control" 
          id="receiptMessage" 
          rows="3"
          placeholder="Example:&#10;M-Pesa Transaction Code: XYZ123456&#10;Amount Paid: KES 5,000&#10;Payment Date: October 20, 2025"
          required
          minlength="10"
          maxlength="500"
        ></textarea>
        <div class="form-text">
          Provide payment method, reference number, amount, and date. This will be verified by the teacher.
        </div>
        <div class="invalid-feedback">
          Please provide detailed payment information (minimum 10 characters)
        </div>
      </div>
      
      <!-- Submit Button -->
      <button type="submit" class="btn btn-primary btn-lg w-100 mb-2" id="registerBtn">
        Register & Join Class
        <i class="bi bi-box-arrow-in-right ms-2"></i>
      </button>
      
      <!-- Back Button -->
      <button type="button" class="btn btn-link w-100" id="backBtn">
        <i class="bi bi-arrow-left me-2"></i>
        Use different phone number
      </button>
      
    </form>
  `;
  
  // Setup form handlers
  document.getElementById('registrationForm').addEventListener('submit', handleRegistration);
  document.getElementById('backBtn').addEventListener('click', goBack);
  
  // Real-time validation
  setupFormValidation();
  
  // Auto-focus first input
  setTimeout(() => document.getElementById('studentName').focus(), 300);
}

function setupFormValidation() {
  const fields = ['studentName', 'subjects', 'receiptMessage'];
  
  fields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    
    field.addEventListener('blur', function() {
      if (this.value.trim().length >= this.minLength) {
        this.classList.remove('is-invalid');
        this.classList.add('is-valid');
      } else if (this.value.trim().length > 0) {
        this.classList.remove('is-valid');
        this.classList.add('is-invalid');
      }
    });
    
    // Remove validation styling on input
    field.addEventListener('input', function() {
      if (this.classList.contains('is-invalid') && this.value.trim().length >= this.minLength) {
        this.classList.remove('is-invalid');
        this.classList.add('is-valid');
      }
    });
  });
  
  // Class select validation
  document.getElementById('studentClass').addEventListener('change', function() {
    if (this.value) {
      this.classList.remove('is-invalid');
      this.classList.add('is-valid');
    }
  });
}

function goBack() {
  // Reset to check-in screen
  registrationCard.classList.add('d-none');
  checkinCard.classList.remove('d-none');
  
  // Reset phone input
  parentPhoneInput.value = '';
  parentPhoneInput.classList.remove('is-valid', 'is-invalid');
  parentPhoneInput.focus();
  
  // Reset button
  setButtonLoading(continueBtn, false);
}

// ============================================
// FORM SUBMISSION & REGISTRATION
// ============================================

async function handleRegistration(e) {
  e.preventDefault();
  
  const form = e.target;
  
  // Collect data
  const registrationData = {
    parentPhone: document.getElementById('regParentPhone').value,
    studentName: document.getElementById('studentName').value.trim(),
    class: document.getElementById('studentClass').value,
    subjects: document.getElementById('subjects').value.trim(),
    receiptMessage: document.getElementById('receiptMessage').value.trim()
  };
  
  // Validate form
  if (!form.checkValidity()) {
    form.classList.add('was-validated');
    
    // Focus first invalid field
    const firstInvalid = form.querySelector(':invalid');
    if (firstInvalid) {
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    showErrorToast('Please fill in all required fields correctly');
    return;
  }
  
  // Additional validation
  if (registrationData.studentName.length < 2) {
    showErrorToast('Please enter a valid student name');
    document.getElementById('studentName').focus();
    return;
  }
  
  if (!registrationData.class) {
    showErrorToast('Please select a class');
    document.getElementById('studentClass').focus();
    return;
  }
  
  if (registrationData.subjects.length < 3) {
    showErrorToast('Please enter at least one subject');
    document.getElementById('subjects').focus();
    return;
  }
  
  if (registrationData.receiptMessage.length < 10) {
    showErrorToast('Please provide more detailed payment information');
    document.getElementById('receiptMessage').focus();
    return;
  }
  
  // Show loading
  const registerBtn = document.getElementById('registerBtn');
  setButtonLoading(registerBtn, true, 'Registering...');
  
  try {
    // Save to Firebase
    await saveRegistration(registrationData);
    
    // Show success and redirect to Zoom
    await handleSuccessfulRegistration();
    
  } catch (error) {
    console.error('Registration error:', error);
    
    // Reset button
    setButtonLoading(registerBtn, false);
    
    // Handle specific errors
    if (error.code === 'permission-denied') {
      showErrorAlert('Registration failed due to permissions. You may already be registered. Please refresh the page and try again.');
    } else if (error.code === 'unavailable') {
      showErrorAlert('Connection error. Please check your internet connection and try again.');
    } else if (error.code === 'failed-precondition') {
      showErrorAlert('The system is temporarily unavailable. Please try again in a moment.');
    } else {
      showErrorAlert('Registration failed. Please try again or contact support if the problem persists.');
    }
  }
}

async function saveRegistration(data) {
  const docRef = doc(db, 'sessions', SESSION, data.parentPhone);
  
  // Prepare document
  const registrationDoc = {
    studentName: data.studentName,
    parentPhone: data.parentPhone,
    class: data.class,
    subjects: data.subjects,
    receiptMessage: data.receiptMessage,
    registeredAt: serverTimestamp(),
    lastAccessed: serverTimestamp(),
    session: SESSION
  };
  
  // Save to Firestore
  await setDoc(docRef, registrationDoc);
  
  console.log('Registration saved successfully:', data.parentPhone);
}

async function handleSuccessfulRegistration() {
  // Show success message
  showSuccessScreen('Registration Successful! ✓', 'Preparing to redirect to class...');
  
  // Wait a moment for user to see success
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Redirect to Zoom
  await redirectToZoom();
}

// ============================================
// WELCOME BACK SCREEN (RETURNING STUDENT)
// ============================================

function showWelcomeScreen(studentData) {
  // Hide check-in
  checkinCard.classList.add('d-none');
  
  // Show welcome
  welcomeCard.classList.remove('d-none');
  welcomeCard.classList.add('slide-in-up');
  
  // Format registration date
  const regDate = studentData.registeredAt?.toDate ? 
    studentData.registeredAt.toDate().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }) : 'Recently';
  
  // Build welcome HTML
  welcomeCard.querySelector('.card-body').innerHTML = `
    <div class="py-4 text-center">
      <!-- Profile Icon -->
      <div class="mb-4">
        <div style="width: 5rem; height: 5rem; background: var(--primary-gradient); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 2.5rem; color: white;">
          ${studentData.studentName.charAt(0).toUpperCase()}
        </div>
      </div>
      
      <!-- Welcome Message -->
      <h3 class="fw-bold mb-2">Welcome Back, ${studentData.studentName}! 👋</h3>
      <p class="text-muted mb-4">
        We found your registration for <strong>${SESSION} session</strong>
      </p>
      
      <!-- Student Details Card -->
      <div class="text-start bg-light p-3 rounded mb-4">
        <div class="row mb-2">
          <div class="col-5 text-muted small">Class:</div>
          <div class="col-7"><strong>${studentData.class}</strong></div>
        </div>
        <div class="row mb-2">
          <div class="col-5 text-muted small">Subjects:</div>
          <div class="col-7"><strong>${studentData.subjects}</strong></div>
        </div>
        <div class="row">
          <div class="col-5 text-muted small">Registered:</div>
          <div class="col-7"><strong>${regDate}</strong></div>
        </div>
      </div>
      
      <!-- Countdown Alert -->
      <div class="alert alert-info mb-4">
        <i class="bi bi-info-circle me-2"></i>
        Redirecting you to class in <strong><span id="countdown">3</span></strong> seconds...
      </div>
      
      <!-- Loading Spinner -->
      <div class="spinner-border text-primary mb-4" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      
      <!-- Manual Join Button -->
      <button class="btn btn-primary btn-lg w-100 mb-3" id="joinNowBtn">
        Join Class Now
        <i class="bi bi-box-arrow-in-right ms-2"></i>
      </button>
      
      <!-- Back Link -->
      <div class="mt-3">
        <button class="btn btn-link" id="notYouBtn">
          <i class="bi bi-arrow-left me-1"></i>
          Not you? Use different number
        </button>
      </div>
    </div>
  `;
  
  // Setup handlers
  document.getElementById('joinNowBtn').addEventListener('click', joinNow);
  document.getElementById('notYouBtn').addEventListener('click', goBack);
  
  // Update last accessed timestamp
  updateLastAccessed(studentData.parentPhone);
  
  // Start countdown
  startCountdownRedirect();
}

async function updateLastAccessed(phone) {
  try {
    const docRef = doc(db, 'sessions', SESSION, phone);
    await setDoc(docRef, {
      lastAccessed: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('Error updating last accessed:', error);
    // Non-critical, don't block user flow
  }
}

let countdownInterval;

function startCountdownRedirect() {
  let seconds = 3;
  const countdownEl = document.getElementById('countdown');
  
  countdownInterval = setInterval(() => {
    seconds--;
    if (countdownEl) {
      countdownEl.textContent = seconds;
    }
    
    if (seconds <= 0) {
      clearInterval(countdownInterval);
      joinNow();
    }
  }, 1000);
}

async function joinNow() {
  clearInterval(countdownInterval);
  
  // Show loading state
  const joinBtn = document.getElementById('joinNowBtn');
  if (joinBtn) {
    setButtonLoading(joinBtn, true, 'Joining...');
  }
  
  await redirectToZoom();
}

// ============================================
// ZOOM REDIRECT
// ============================================

async function redirectToZoom() {
  try {
    // Get Zoom link from config
    const configRef = doc(db, 'config', 'zoomLinks');
    const configSnap = await getDoc(configRef);
    
    if (!configSnap.exists()) {
      throw new Error('Configuration not found');
    }
    
    const zoomLink = configSnap.data()[SESSION];
    
    if (!zoomLink || zoomLink.trim() === '') {
      // No link configured yet
      showSuccessScreen(
        'Registration Successful! ✓',
        'Your registration has been saved. The teacher will share the Zoom link soon. Please check back later or contact your teacher.',
        false
      );
      return;
    }
    
    // Validate Zoom link
    if (!zoomLink.includes('zoom.us')) {
      throw new Error('Invalid Zoom link configuration');
    }
    
    // Show redirect message
    showSuccessScreen(
      'Redirecting to Class... 🎓',
      'Opening Zoom meeting. If it doesn\'t open automatically, click the button below.',
      true,
      zoomLink
    );
    
    // Redirect after brief delay
    setTimeout(() => {
      window.location.href = zoomLink;
    }, 2000);
    
  } catch (error) {
    console.error('Error redirecting to Zoom:', error);
    
    if (error.message === 'Configuration not found') {
      showErrorAlert('Class links are not configured yet. Please contact your teacher.');
    } else {
      showErrorAlert('Unable to join class. Please contact your teacher for the Zoom link.');
    }
  }
}

function showSuccessScreen(title, message, showLink = false, zoomLink = '') {
  const container = registrationCard.classList.contains('d-none') ? welcomeCard : registrationCard;
  
  container.querySelector('.card-body').innerHTML = `
    <div class="text-center py-5">
      <!-- Success Icon -->
      <div class="mb-4">
        <div style="width: 5rem; height: 5rem; background: var(--success-light); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 3rem; color: var(--success-color);">
          ✓
        </div>
      </div>
      
      <!-- Title & Message -->
      <h3 class="fw-bold text-success mb-3">${title}</h3>
      <p class="text-muted mb-4">${message}</p>
      
      ${showLink ? `
        <!-- Loading Spinner -->
        <div class="spinner-border text-primary mb-4" role="status">
          <span class="visually-hidden">Redirecting...</span>
        </div>
        
        <!-- Manual Link -->
        <a href="${zoomLink}" class="btn btn-primary btn-lg" target="_blank" rel="noopener noreferrer">
          Open Zoom Manually
          <i class="bi bi-box-arrow-up-right ms-2"></i>
        </a>
      ` : `
        <!-- Back to Home -->
        <a href="/" class="btn btn-outline-primary">
          <i class="bi bi-house me-2"></i>
          Back to Home
        </a>
      `}
    </div>
  `;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function setButtonLoading(button, isLoading, text = 'Loading...') {
  if (isLoading) {
    button.disabled = true;
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
      ${text}
    `;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.originalText || button.innerHTML;
  }
}

function showErrorAlert(message) {
  const alert = document.createElement('div');
  alert.className = 'alert alert-danger alert-dismissible fade show';
  alert.role = 'alert';
  alert.innerHTML = `
    <i class="bi bi-exclamation-triangle me-2"></i>
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
  `;
  
  // Insert at top of visible card
  let targetCard;
  if (!checkinCard.classList.contains('d-none')) {
    targetCard = checkinCard;
  } else if (!registrationCard.classList.contains('d-none')) {
    targetCard = registrationCard;
  } else {
    targetCard = welcomeCard;
  }
  
  targetCard.querySelector('.card-body').prepend(alert);
  
  // Scroll to alert
  alert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  
  // Auto-dismiss after 8 seconds
  setTimeout(() => {
    alert.classList.remove('show');
    setTimeout(() => alert.remove(), 150);
  }, 8000);
}

function showErrorToast(message) {
  showToast('error', 'Error', message);
}

function showSuccessToast(message) {
  showToast('success', 'Success', message);
}

// Toast implementation from UI/UX section
function showToast(type, title, message, duration = 5000) {
  // Implementation from section 9.6
  const toastContainer = document.getElementById('toastContainer') || createToastContainer();
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  
  toast.innerHTML = `
    <div class="toast-icon">${icons[type]}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toastContainer';
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

// Export for use in HTML onclick handlers
window.goBack = goBack;
window.joinNow = joinNow;
```

---

### 10.3 Teacher Dashboard Complete Code

**dashboard-app.js:**
```javascript
import { db, auth } from './firebase-config.js';
import { 
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp 
} from 'firebase/firestore';
import { 
  signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from 'firebase/auth';

// State
let currentUser = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkAuthState();
});

// ============================================
// AUTHENTICATION
// ============================================

function checkAuthState() {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      showDashboard();
    } else {
      currentUser = null;
      showLoginScreen();
    }
  });
}

function showLoginScreen() {
  document.body.innerHTML = `
    <div class="container">
      <div class="row justify-content-center min-vh-100 align-items-center">
        <div class="col-md-5 col-lg-4">
          <div class="card shadow">
            <div class="card-body p-4">
              <div class="text-center mb-4">
                <h2 class="fw-bold">🎓 Teacher Dashboard</h2>
                <p class="text-muted">Sign in to manage student registrations</p>
              </div>
              
              <form id="loginForm">
                <div class="mb-3">
                  <label for="email" class="form-label fw-semibold">Email Address</label>
                  <input 
                    type="email" 
                    class="form-control" 
                    id="email" 
                    placeholder="teacher@school.com"
                    required
                    autocomplete="username"
                  >
                </div>
                
                <div class="mb-4">
                  <label for="password" class="form-label fw-semibold">Password</label>
                  <div class="input-group">
                    <input 
                      type="password" 
                      class="form-control" 
                      id="password" 
                      required
                      autocomplete="current-password"
                    >
                    <button class="btn btn-outline-secondary" type="button" id="togglePassword">
                      <i class="bi bi-eye"></i>
                    </button>
                  </div>
                </div>
                
                <div id="loginError" class="alert alert-danger d-none" role="alert"></div>
                
                <button type="submit" class="btn btn-primary btn-lg w-100" id="loginBtn">
                  Sign In
                  <i class="bi bi-box-arrow-in-right ms-2"></i>
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Setup event listeners
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('togglePassword').addEventListener('click', togglePasswordVisibility);
  document.getElementById('email').focus();
}

function togglePasswordVisibility() {
  const passwordInput = document.getElementById('password');
  const toggleBtn = document.getElementById('togglePassword');
  const icon = toggleBtn.querySelector('i');
  
  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    icon.className = 'bi bi-eye-slash';

} else {
    passwordInput.type = 'password';
    icon.className = 'bi bi-eye';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const loginBtn = document.getElementById('loginBtn');
  const errorDiv = document.getElementById('loginError');
  
  // Hide previous errors
  errorDiv.classList.add('d-none');
  
  // Show loading
  setButtonLoading(loginBtn, true, 'Signing in...');
  
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged will handle the redirect
  } catch (error) {
    console.error('Login error:', error);
    
    // Reset button
    setButtonLoading(loginBtn, false);
    
    // Show error message
    let errorMessage = 'Login failed. Please try again.';
    
    switch (error.code) {
      case 'auth/invalid-email':
        errorMessage = 'Invalid email address format.';
        break;
      case 'auth/user-disabled':
        errorMessage = 'This account has been disabled.';
        break;
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        errorMessage = 'Invalid email or password.';
        break;
      case 'auth/too-many-requests':
        errorMessage = 'Too many failed login attempts. Please try again later.';
        break;
      case 'auth/network-request-failed':
        errorMessage = 'Network error. Please check your connection.';
        break;
    }
    
    errorDiv.textContent = errorMessage;
    errorDiv.classList.remove('d-none');
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    showLoginScreen();
  } catch (error) {
    console.error('Logout error:', error);
    showErrorToast('Failed to logout. Please try again.');
  }
}

// ============================================
// DASHBOARD MAIN VIEW
// ============================================

function showDashboard() {
  document.body.innerHTML = `
    <div class="container-fluid">
      <!-- Header -->
      <div class="row bg-white shadow-sm py-3 mb-4 sticky-top">
        <div class="col">
          <div class="d-flex justify-content-between align-items-center">
            <h3 class="mb-0 fw-bold">
              <i class="bi bi-speedometer2 me-2"></i>
              Student Registration Dashboard
            </h3>
            <div>
              <span class="me-3 text-muted">
                <i class="bi bi-person-circle me-1"></i>
                ${currentUser.email}
              </span>
              <button class="btn btn-outline-danger" id="logoutBtn">
                <i class="bi bi-box-arrow-right me-1"></i>
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div class="container py-4">
        
        <!-- Zoom Link Management Section -->
        <div class="card shadow-sm mb-4">
          <div class="card-header bg-primary text-white">
            <h5 class="mb-0">
              <i class="bi bi-link-45deg me-2"></i>
              Zoom Link Management
            </h5>
          </div>
          <div class="card-body p-4">
            
            <!-- Setup Warning (shown if links not configured) -->
            <div id="setupWarning" class="alert alert-warning d-none" role="alert">
              <i class="bi bi-exclamation-triangle me-2"></i>
              <strong>Setup Required:</strong> Add your Zoom meeting links before sharing registration links with students.
            </div>
            
            <!-- Morning Session Link -->
            <div class="mb-4">
              <label for="morningLinkInput" class="form-label fw-semibold">
                <span class="session-badge morning-badge me-2">🌅 Morning Session</span>
              </label>
              <div class="input-group input-group-lg">
                <input 
                  type="url" 
                  class="form-control" 
                  id="morningLinkInput" 
                  placeholder="https://zoom.us/j/123456789?pwd=..."
                >
                <button class="btn btn-primary" id="morningBtn" style="min-width: 120px;">
                  Add Link
                </button>
              </div>
              <div class="form-text mt-2" id="morningLastUpdated">
                💡 Last updated: Not set
              </div>
            </div>
            
            <!-- Evening Session Link -->
            <div class="mb-3">
              <label for="eveningLinkInput" class="form-label fw-semibold">
                <span class="session-badge evening-badge me-2">🌙 Evening Session</span>
              </label>
              <div class="input-group input-group-lg">
                <input 
                  type="url" 
                  class="form-control" 
                  id="eveningLinkInput" 
                  placeholder="https://zoom.us/j/987654321?pwd=..."
                >
                <button class="btn btn-primary" id="eveningBtn" style="min-width: 120px;">
                  Add Link
                </button>
              </div>
              <div class="form-text mt-2" id="eveningLastUpdated">
                💡 Last updated: Not set
              </div>
            </div>
            
            <!-- Registration Links Info -->
            <div class="alert alert-info mt-4 mb-0">
              <strong>📋 Share these registration links with students:</strong>
              <div class="mt-2">
                <div class="input-group mb-2">
                  <input type="text" class="form-control" id="morningRegLink" readonly>
                  <button class="btn btn-outline-secondary" onclick="copyToClipboard('morningRegLink')">
                    <i class="bi bi-clipboard"></i> Copy
                  </button>
                </div>
                <div class="input-group">
                  <input type="text" class="form-control" id="eveningRegLink" readonly>
                  <button class="btn btn-outline-secondary" onclick="copyToClipboard('eveningRegLink')">
                    <i class="bi bi-clipboard"></i> Copy
                  </button>
                </div>
              </div>
            </div>
            
          </div>
        </div>
        
        <!-- Students Management Section -->
        <div class="card shadow-sm">
          <div class="card-header bg-white">
            <ul class="nav nav-tabs card-header-tabs" id="sessionTabs" role="tablist">
              <li class="nav-item" role="presentation">
                <button class="nav-link active" id="morning-tab" data-bs-toggle="tab" 
                        data-bs-target="#morningTab" type="button" role="tab">
                  🌅 Morning Session (<span id="morningCount" class="fw-bold">0</span>)
                </button>
              </li>
              <li class="nav-item" role="presentation">
                <button class="nav-link" id="evening-tab" data-bs-toggle="tab" 
                        data-bs-target="#eveningTab" type="button" role="tab">
                  🌙 Evening Session (<span id="eveningCount" class="fw-bold">0</span>)
                </button>
              </li>
            </ul>
          </div>
          
          <div class="card-body">
            <div class="tab-content" id="sessionTabContent">
              
              <!-- Morning Students Tab -->
              <div class="tab-pane fade show active" id="morningTab" role="tabpanel">
                <div id="morningStudents">
                  <div class="text-center py-5">
                    <div class="spinner-border text-primary" role="status">
                      <span class="visually-hidden">Loading...</span>
                    </div>
                    <p class="text-muted mt-3">Loading students...</p>
                  </div>
                </div>
              </div>
              
              <!-- Evening Students Tab -->
              <div class="tab-pane fade" id="eveningTab" role="tabpanel">
                <div id="eveningStudents">
                  <div class="text-center py-5">
                    <div class="spinner-border text-primary" role="status">
                      <span class="visually-hidden">Loading...</span>
                    </div>
                    <p class="text-muted mt-3">Loading students...</p>
                  </div>
                </div>
              </div>
              
            </div>
          </div>
        </div>
        
      </div>
    </div>
    
    <!-- Toast Container -->
    <div id="toastContainer" class="toast-container"></div>
  `;
  
  // Set registration links
  const baseUrl = window.location.origin;
  document.getElementById('morningRegLink').value = `${baseUrl}/morning.html`;
  document.getElementById('eveningRegLink').value = `${baseUrl}/evening.html`;
  
  // Setup event listeners
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('morningBtn').addEventListener('click', () => handleZoomLinkUpdate('morning'));
  document.getElementById('eveningBtn').addEventListener('click', () => handleZoomLinkUpdate('evening'));
  
  // Tab change listeners
  document.getElementById('morning-tab').addEventListener('shown.bs.tab', () => loadStudents('morning'));
  document.getElementById('evening-tab').addEventListener('shown.bs.tab', () => loadStudents('evening'));
  
  // Initialize
  loadZoomLinks();
  loadStudents('morning'); // Load morning by default
}

// ============================================
// ZOOM LINK MANAGEMENT
// ============================================

async function loadZoomLinks() {
  try {
    const docRef = doc(db, 'config', 'zoomLinks');
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists() && (docSnap.data().morning || docSnap.data().evening)) {
      const data = docSnap.data();
      
      // Morning link
      if (data.morning) {
        document.getElementById('morningLinkInput').value = data.morning;
        updateLinkButton('morning', 'update');
        if (data.morningLastUpdated) {
          updateLastUpdatedText('morning', data.morningLastUpdated.toDate());
        }
      }
      
      // Evening link
      if (data.evening) {
        document.getElementById('eveningLinkInput').value = data.evening;
        updateLinkButton('evening', 'update');
        if (data.eveningLastUpdated) {
          updateLastUpdatedText('evening', data.eveningLastUpdated.toDate());
        }
      }
      
      // Hide warning if both links are set
      if (data.morning && data.evening) {
        document.getElementById('setupWarning').classList.add('d-none');
      } else {
        document.getElementById('setupWarning').classList.remove('d-none');
      }
    } else {
      // No links configured - show warning
      document.getElementById('setupWarning').classList.remove('d-none');
    }
  } catch (error) {
    console.error('Error loading zoom links:', error);
    showErrorToast('Failed to load Zoom links');
  }
}

function updateLinkButton(session, mode) {
  const btn = document.getElementById(`${session}Btn`);
  
  if (mode === 'update') {
    btn.textContent = 'Update Link';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-success');
  } else {
    btn.textContent = 'Add Link';
    btn.classList.remove('btn-success');
    btn.classList.add('btn-primary');
  }
}

function updateLastUpdatedText(session, date) {
  const el = document.getElementById(`${session}LastUpdated`);
  const formatted = date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  el.innerHTML = `💡 Last updated: ${formatted}`;
}

async function handleZoomLinkUpdate(session) {
  const input = document.getElementById(`${session}LinkInput`);
  const btn = document.getElementById(`${session}Btn`);
  const url = input.value.trim();
  
  // Validate
  const validation = validateZoomLink(url);
  if (!validation.valid) {
    showErrorToast(validation.message);
    input.classList.add('is-invalid');
    setTimeout(() => input.classList.remove('is-invalid'), 3000);
    return;
  }
  
  input.classList.remove('is-invalid');
  
  // Confirm if updating existing link
  const isUpdate = btn.textContent.includes('Update');
  if (isUpdate) {
    const confirmed = await showConfirmDialog(
      `Update ${session.charAt(0).toUpperCase() + session.slice(1)} Link`,
      'Students will be redirected to the new link immediately. Continue?'
    );
    
    if (!confirmed) return;
  }
  
  // Show loading
  setButtonLoading(btn, true, isUpdate ? 'Updating...' : 'Adding...');
  
  try {
    const docRef = doc(db, 'config', 'zoomLinks');
    
    // Save to Firebase
    await setDoc(docRef, {
      [session]: url,
      [`${session}LastUpdated`]: serverTimestamp()
    }, { merge: true });
    
    // Success
    showSuccessToast(`${session.charAt(0).toUpperCase() + session.slice(1)} link ${isUpdate ? 'updated' : 'added'} successfully!`);
    
    // Update UI
    updateLinkButton(session, 'update');
    updateLastUpdatedText(session, new Date());
    
    // Hide warning if both links are now set
    const docSnap = await getDoc(docRef);
    if (docSnap.exists() && docSnap.data().morning && docSnap.data().evening) {
      document.getElementById('setupWarning').classList.add('d-none');
    }
    
  } catch (error) {
    console.error('Error saving zoom link:', error);
    showErrorToast('Failed to save link. Please try again.');
  } finally {
    setButtonLoading(btn, false);
  }
}

function validateZoomLink(url) {
  if (!url || url === '') {
    return { valid: false, message: 'Please enter a Zoom link' };
  }
  
  try {
    const urlObj = new URL(url);
    
    if (!urlObj.hostname.includes('zoom.us')) {
      return { valid: false, message: 'Please enter a valid Zoom meeting link (must contain zoom.us)' };
    }
    
    return { valid: true };
  } catch (e) {
    return { valid: false, message: 'Please enter a valid URL' };
  }
}

// ============================================
// STUDENT MANAGEMENT
// ============================================

async function loadStudents(session) {
  const container = document.getElementById(`${session}Students`);
  
  // Show loading
  container.innerHTML = `
    <div class="text-center py-5">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      <p class="text-muted mt-3">Loading ${session} students...</p>
    </div>
  `;
  
  try {
    const studentsRef = collection(db, 'sessions', session);
    const querySnapshot = await getDocs(studentsRef);
    
    const students = [];
    querySnapshot.forEach((doc) => {
      students.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Sort by registration date (newest first)
    students.sort((a, b) => {
      const dateA = a.registeredAt?.toMillis() || 0;
      const dateB = b.registeredAt?.toMillis() || 0;
      return dateB - dateA;
    });
    
    // Update count
    document.getElementById(`${session}Count`).textContent = students.length;
    
    // Render table
    renderStudentsTable(container, students, session);
    
  } catch (error) {
    console.error('Error loading students:', error);
    container.innerHTML = `
      <div class="alert alert-danger">
        <i class="bi bi-exclamation-triangle me-2"></i>
        Failed to load students. Please refresh the page.
      </div>
    `;
  }
}

function renderStudentsTable(container, students, session) {
  if (students.length === 0) {
    container.innerHTML = `
      <div class="alert alert-info">
        <i class="bi bi-info-circle me-2"></i>
        No students registered for ${session} session yet.
        <br><br>
        <strong>Share the registration link:</strong>
        <div class="input-group mt-2">
          <input type="text" class="form-control" value="${window.location.origin}/${session}.html" readonly>
          <button class="btn btn-outline-secondary" onclick="copyToClipboard('${session}RegLink')">
            <i class="bi bi-clipboard"></i> Copy
          </button>
        </div>
      </div>
    `;
    return;
  }
  
  let tableHTML = `
    <div class="table-responsive">
      <table class="table table-hover table-striped align-middle">
        <thead class="table-dark">
          <tr>
            <th style="width: 40px;">#</th>
            <th>Student Name</th>
            <th>Parent Phone</th>
            <th>Class</th>
            <th>Subjects</th>
            <th>Payment Receipt</th>
            <th>Registered</th>
            <th style="width: 100px;">Action</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  students.forEach((student, index) => {
    const regDate = student.registeredAt?.toDate ? 
      student.registeredAt.toDate().toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) : 'N/A';
    
    tableHTML += `
      <tr>
        <td><strong>${index + 1}</strong></td>
        <td>
          <strong>${escapeHtml(student.studentName)}</strong>
        </td>
        <td>
          <code>${escapeHtml(student.parentPhone)}</code>
        </td>
        <td>
          <span class="badge bg-primary">${escapeHtml(student.class)}</span>
        </td>
        <td>
          <small class="text-muted">${escapeHtml(student.subjects)}</small>
        </td>
        <td>
          <small class="text-muted" style="max-width: 200px; display: inline-block; overflow: hidden; text-overflow: ellipsis;" 
                 title="${escapeHtml(student.receiptMessage)}">
            ${escapeHtml(student.receiptMessage)}
          </small>
        </td>
        <td>
          <small>${regDate}</small>
        </td>
        <td>
          <button class="btn btn-sm btn-danger" 
                  onclick="deleteStudent('${session}', '${escapeHtml(student.id)}', '${escapeHtml(student.studentName)}')">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>
    `;
  });
  
  tableHTML += `
        </tbody>
      </table>
    </div>
    
    <!-- Export Option (Future Enhancement) -->
    <div class="text-end mt-3">
      <button class="btn btn-outline-primary" onclick="exportToCSV('${session}')">
        <i class="bi bi-download me-2"></i>
        Export to CSV
      </button>
    </div>
  `;
  
  container.innerHTML = tableHTML;
}

async function deleteStudent(session, phoneNumber, studentName) {
  const confirmed = await showConfirmDialog(
    'Delete Student',
    `Are you sure you want to delete <strong>${studentName}</strong> from ${session} session?`,
    `Parent Phone: ${phoneNumber}`,
    'This action cannot be undone. The student will need to register again to rejoin the class.'
  );
  
  if (!confirmed) return;
  
  // Show loading overlay
  showLoadingToast('Deleting student...');
  
  try {
    const docRef = doc(db, 'sessions', session, phoneNumber);
    await deleteDoc(docRef);
    
    hideLoadingToast();
    showSuccessToast(`${studentName} deleted successfully`);
    
    // Reload students
    await loadStudents(session);
    
  } catch (error) {
    console.error('Error deleting student:', error);
    hideLoadingToast();
    showErrorToast('Failed to delete student. Please try again.');
  }
}

// ============================================
// EXPORT TO CSV
// ============================================

async function exportToCSV(session) {
  try {
    showLoadingToast('Preparing export...');
    
    const studentsRef = collection(db, 'sessions', session);
    const querySnapshot = await getDocs(studentsRef);
    
    const students = [];
    querySnapshot.forEach((doc) => {
      students.push(doc.data());
    });
    
    if (students.length === 0) {
      hideLoadingToast();
      showWarningToast('No students to export');
      return;
    }
    
    // Build CSV
    let csv = 'Student Name,Parent Phone,Class,Subjects,Payment Receipt,Registered At\n';
    
    students.forEach(student => {
      const regDate = student.registeredAt?.toDate ? 
        student.registeredAt.toDate().toLocaleString('en-GB') : 'N/A';
      
      csv += `"${student.studentName}",`;
      csv += `"${student.parentPhone}",`;
      csv += `"${student.class}",`;
      csv += `"${student.subjects}",`;
      csv += `"${student.receiptMessage}",`;
      csv += `"${regDate}"\n`;
    });
    
    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${session}-students-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    
    hideLoadingToast();
    showSuccessToast('CSV exported successfully');
    
  } catch (error) {
    console.error('Error exporting CSV:', error);
    hideLoadingToast();
    showErrorToast('Failed to export CSV');
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function copyToClipboard(elementId) {
  const input = document.getElementById(elementId);
  input.select();
  input.setSelectionRange(0, 99999); // For mobile
  
  try {
    document.execCommand('copy');
    showSuccessToast('Link copied to clipboard!');
  } catch (err) {
    // Fallback for modern browsers
    navigator.clipboard.writeText(input.value).then(() => {
      showSuccessToast('Link copied to clipboard!');
    }).catch(() => {
      showErrorToast('Failed to copy link');
    });
  }
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setButtonLoading(button, isLoading, text = 'Loading...') {
  if (isLoading) {
    button.disabled = true;
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2"></span>
      ${text}
    `;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.originalText || 'Submit';
  }
}

function showConfirmDialog(title, message, details = '', warning = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '10000';
    
    overlay.innerHTML = `
      <div class="modal-container">
        <div class="modal-header">
          <h5 class="modal-title">${title}</h5>
          <button class="modal-close" id="modalCloseBtn">×</button>
        </div>
        <div class="modal-body text-center">
          <div class="modal-icon danger mb-3">
            <i class="bi bi-exclamation-triangle"></i>
          </div>
          <p class="mb-3">${message}</p>
          ${details ? `<p class="text-muted mb-3"><small>${details}</small></p>` : ''}
          ${warning ? `<div class="alert alert-warning text-start">${warning}</div>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline-secondary" id="modalCancelBtn">Cancel</button>
          <button class="btn btn-danger" id="modalConfirmBtn">Confirm</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Event listeners
    document.getElementById('modalCloseBtn').onclick = () => {
      overlay.remove();
      resolve(false);
    };
    
    document.getElementById('modalCancelBtn').onclick = () => {
      overlay.remove();
      resolve(false);
    };
    
    document.getElementById('modalConfirmBtn').onclick = () => {
      overlay.remove();
      resolve(true);
    };
    
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    };
  });
}

// Toast functions
function showToast(type, title, message, duration = 5000) {
  const toastContainer = document.getElementById('toastContainer') || createToastContainer();
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  
  toast.innerHTML = `
    <div class="toast-icon">${icons[type]}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toastContainer';
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

function showSuccessToast(message) {
  showToast('success', 'Success', message);
}

function showErrorToast(message) {
  showToast('error', 'Error', message);
}

function showWarningToast(message) {
  showToast('warning', 'Warning', message);
}

function showLoadingToast(message) {
  const toastContainer = document.getElementById('toastContainer') || createToastContainer();
  
  const toast = document.createElement('div');
  toast.id = 'loadingToast';
  toast.className = 'toast toast-info';
  
  toast.innerHTML = `
    <div class="spinner-border spinner-border-sm text-primary" style="width: 1.5rem; height: 1.5rem;"></div>
    <div class="toast-content">
      <div class="toast-message">${message}</div>
    </div>
  `;
  
  toastContainer.appendChild(toast);
}

function hideLoadingToast() {
  const toast = document.getElementById('loadingToast');
  if (toast) toast.remove();
}

// Make functions globally accessible for onclick handlers
window.deleteStudent = deleteStudent;
window.exportToCSV = exportToCSV;
window.copyToClipboard = copyToClipboard;
```

---

## 11. Security & Validation {#security-validation}

### 11.1 Firebase Security Rules (Complete)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper function to check if user is authenticated
    function isAuthenticated() {
      return request.auth != null;
    }
    
    // Helper function to validate phone number format
    function isValidPhone(phone) {
      return phone is string && phone.matches('^0[17][0-9]{8}$');
    }
    
    // Helper function to validate student data
    function isValidStudentData(data) {
      return data.keys().hasAll(['studentName', 'parentPhone', 'class', 'subjects', 'receiptMessage', 'registeredAt', 'session']) &&
             data.studentName is string && data.studentName.size() >= 2 && data.studentName.size() <= 100 &&
             data.parentPhone is string && isValidPhone(data.parentPhone) &&
             data.class is string && data.class.size() > 0 &&
             data.subjects is string && data.subjects.size() >= 3 && data.subjects.size() <= 200 &&
             data.receiptMessage is string && data.receiptMessage.size() >= 10 && data.receiptMessage.size() <= 500 &&
             data.session is string && (data.session == 'morning' || data.session == 'evening');
    }
    
    // Config collection - Zoom links
    match /config/zoomLinks {
      // Anyone can read (students need to get Zoom links)
      allow read: if true;
      
      // Only authenticated teachers can write
      allow write: if isAuthenticated();
    }
    
    // Sessions collection - Student registrations
    match /sessions/{session}/{phone} {
      // Students can create their own registration
      // Phone number in path must match parentPhone in data
      allow create: if isValidPhone(phone) &&
                       phone == request.resource.data.parentPhone &&
                       isValidStudentData(request.resource.data) &&
                       request.resource


