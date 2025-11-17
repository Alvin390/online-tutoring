// Student Registration Application
import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { countries, validatePhoneNumber, formatPhoneNumber } from './countries.js';

// DOM Elements
let countrySelect, dialCodeSpan, parentPhoneInput, continueBtn;
let checkinCard, registrationCard, welcomeCard;
let selectedCountry = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeElements();
    populateCountrySelect();
    setupEventListeners();
});

// ============================================
// INITIALIZATION
// ============================================

function initializeElements() {
    countrySelect = document.getElementById('countrySelect');
    dialCodeSpan = document.getElementById('dialCode');
    parentPhoneInput = document.getElementById('parentPhone');
    continueBtn = document.getElementById('continueBtn');
    checkinCard = document.getElementById('checkinCard');
    registrationCard = document.getElementById('registrationCard');
    welcomeCard = document.getElementById('welcomeCard');
}

function populateCountrySelect() {
    // Populate country dropdown
    countries.forEach(country => {
        const option = document.createElement('option');
        option.value = country.code;
        option.textContent = `${country.flag} ${country.name} (${country.dial})`;
        option.dataset.dial = country.dial;
        option.dataset.length = country.length;
        countrySelect.appendChild(option);
    });
    
    // Set Kenya as default
    countrySelect.value = 'KE';
    handleCountryChange();
}

function setupEventListeners() {
    // Country selection
    countrySelect.addEventListener('change', handleCountryChange);
    
    // Phone input
    parentPhoneInput.addEventListener('input', formatPhoneInput);
    parentPhoneInput.addEventListener('blur', validatePhoneInput);
    
    // Check-in form
    document.getElementById('checkinForm').addEventListener('submit', handleCheckin);
}

// ============================================
// COUNTRY & PHONE HANDLING
// ============================================

function handleCountryChange() {
    const selectedCode = countrySelect.value;
    if (!selectedCode) {
        dialCodeSpan.textContent = '+';
        selectedCountry = null;
        return;
    }
    
    selectedCountry = countries.find(c => c.code === selectedCode);
    if (selectedCountry) {
        dialCodeSpan.textContent = selectedCountry.dial;
        parentPhoneInput.placeholder = selectedCountry.format.replace(/X/g, '•');
        parentPhoneInput.value = '';
        parentPhoneInput.classList.remove('is-valid', 'is-invalid');
        document.getElementById('phoneHelp').textContent = 
            `Enter ${selectedCountry.length}-digit phone number`;
    }
}

function formatPhoneInput(e) {
    if (!selectedCountry) return;
    
    // Remove all non-digit characters
    let value = e.target.value.replace(/\D/g, '');
    
    // Limit to country's max length
    if (value.length > selectedCountry.length) {
        value = value.slice(0, selectedCountry.length);
    }
    
    e.target.value = value;
}

function validatePhoneInput() {
    if (!selectedCountry || !parentPhoneInput.value) {
        parentPhoneInput.classList.remove('is-valid', 'is-invalid');
        return;
    }
    
    const isValid = validatePhoneNumber(selectedCountry, parentPhoneInput.value);
    
    if (isValid) {
        parentPhoneInput.classList.remove('is-invalid');
        parentPhoneInput.classList.add('is-valid');
    } else {
        parentPhoneInput.classList.remove('is-valid');
        parentPhoneInput.classList.add('is-invalid');
    }
}

// ============================================
// CHECK-IN FLOW
// ============================================

async function handleCheckin(e) {
    e.preventDefault();
    
    if (!selectedCountry) {
        showErrorToast('Please select a country');
        countrySelect.focus();
        return;
    }
    
    const phoneNumber = parentPhoneInput.value.trim();
    
    // Validate
    if (!validatePhoneNumber(selectedCountry, phoneNumber)) {
        parentPhoneInput.classList.add('is-invalid');
        document.getElementById('phoneError').textContent = 
            `Please enter a valid ${selectedCountry.length}-digit phone number`;
        return;
    }
    
    parentPhoneInput.classList.remove('is-invalid');
    
    // Create full phone number with country code
    const fullPhoneNumber = `${selectedCountry.dial}${phoneNumber}`;
    
    // Show loading
    setButtonLoading(continueBtn, true, 'Checking registration...');
    
    try {
        await checkRegistration(fullPhoneNumber);
    } catch (error) {
        console.error('Error during check-in:', error);
        setButtonLoading(continueBtn, false);
        showErrorAlert('Unable to check registration. Please check your connection and try again.');
    }
}

async function checkRegistration(phoneNumber) {
    const docRef = doc(db, 'sessions', SESSION, phoneNumber);
    
    try {
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            // Returning student
            const studentData = docSnap.data();
            showWelcomeScreen(studentData);
        } else {
            // New student
            showRegistrationForm(phoneNumber);
        }
    } catch (error) {
        throw error;
    }
}

// ============================================
// REGISTRATION FORM (NEW STUDENT)
// ============================================

function showRegistrationForm(phoneNumber) {
    // Hide check-in
    checkinCard.classList.add('d-none');
    
    // Show registration
    registrationCard.classList.remove('d-none');
    registrationCard.classList.add('slide-in-up');
    
    // Build form HTML
    registrationCard.innerHTML = `
        <div class="text-center mb-4">
            <div class="session-badge ${SESSION}-badge mb-3">
                ${SESSION === 'morning' ? '<i class="bi bi-sunrise-fill me-2"></i>' : '<i class="bi bi-moon-stars-fill me-2"></i>'}
                ${SESSION.charAt(0).toUpperCase() + SESSION.slice(1)} Session
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
                    value="${phoneNumber}"
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
                    <option value="Form One">Form One</option>
                    <option value="Form Two">Form Two</option>
                    <option value="Form Three">Form Three</option>
                    <option value="Form Four">Form Four</option>
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
                    placeholder="Example:
M-Pesa Transaction Code: XYZ123456
Amount Paid: KES 5,000
Payment Date: October 20, 2025"
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
            <button type="button" class="btn btn-outline-secondary w-100" id="backBtn">
                <i class="bi bi-arrow-left me-2"></i>
                Use different phone number
            </button>
            
        </form>
    `;
    
    // Setup form handlers
    document.getElementById('registrationForm').addEventListener('submit', (e) => handleRegistration(e, phoneNumber));
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
            if (this.value.trim().length >= (this.minLength || 1)) {
                this.classList.remove('is-invalid');
                this.classList.add('is-valid');
            } else if (this.value.trim().length > 0) {
                this.classList.remove('is-valid');
                this.classList.add('is-invalid');
            }
        });
        
        field.addEventListener('input', function() {
            if (this.classList.contains('is-invalid') && this.value.trim().length >= (this.minLength || 1)) {
                this.classList.remove('is-invalid');
                this.classList.add('is-valid');
            }
        });
    });
    
    // Class select validation
    const classSelect = document.getElementById('studentClass');
    if (classSelect) {
        classSelect.addEventListener('change', function() {
            if (this.value) {
                this.classList.remove('is-invalid');
                this.classList.add('is-valid');
            }
        });
    }
}

function goBack() {
    // Reset to check-in screen
    registrationCard.classList.add('d-none');
    welcomeCard.classList.add('d-none');
    checkinCard.classList.remove('d-none');
    
    // Reset inputs
    parentPhoneInput.value = '';
    parentPhoneInput.classList.remove('is-valid', 'is-invalid');
    countrySelect.value = 'KE';
    handleCountryChange();
    parentPhoneInput.focus();
    
    // Reset button
    setButtonLoading(continueBtn, false);
}

// ============================================
// FORM SUBMISSION & REGISTRATION
// ============================================

async function handleRegistration(e, phoneNumber) {
    e.preventDefault();
    
    const form = e.target;
    
    // Collect data
    const registrationData = {
        parentPhone: phoneNumber,
        studentName: document.getElementById('studentName').value.trim(),
        class: document.getElementById('studentClass').value,
        subjects: document.getElementById('subjects').value.trim(),
        receiptMessage: document.getElementById('receiptMessage').value.trim()
    };
    
    // Validate form
    if (!form.checkValidity()) {
        form.classList.add('was-validated');
        
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
    welcomeCard.innerHTML = `
        <div class="py-4 text-center">
            <!-- Profile Icon -->
            <div class="mb-4">
                <div style="width: 5rem; height: 5rem; background: var(--${SESSION}-gradient); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 2.5rem; color: white; box-shadow: var(--shadow-lg);">
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

async function updateLastAccessed(phoneNumber) {
    try {
        const docRef = doc(db, 'sessions', SESSION, phoneNumber);
        await setDoc(docRef, {
            lastAccessed: serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error('Error updating last accessed:', error);
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
    
    container.innerHTML = `
        <div class="text-center py-5">
            <!-- Success Icon -->
            <div class="mb-4">
                <div style="width: 5rem; height: 5rem; background: rgba(16, 185, 129, 0.1); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 3rem; color: var(--success-color); box-shadow: var(--shadow-lg);">
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
                <a href="index.html" class="btn btn-outline-primary">
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
    
    targetCard.prepend(alert);
    
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
