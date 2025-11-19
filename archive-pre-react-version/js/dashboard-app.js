// Teacher Dashboard Application
import { db, auth } from './firebase-config.js';
import { 
    doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { 
    signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// State
let currentUser = null;
let morningStudentsCount = 0;
let eveningStudentsCount = 0;
let dashboardInitialized = false;

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
    // Hide dashboard and show login
    document.getElementById('dashboardContainer').classList.add('d-none');
    document.getElementById('loginContainer').classList.remove('d-none');
    
    document.getElementById('loginContainer').innerHTML = `
        <div class="hero-section" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
            <div class="hero-overlay"></div>
            <div class="container position-relative">
                <div class="row min-vh-100 align-items-center justify-content-center">
                    <div class="col-md-5 col-lg-4">
                        <div class="glass-card animate-fade-in-up">
                            <div class="text-center mb-4">
                                <div class="mb-3">
                                    <i class="bi bi-mortarboard-fill" style="font-size: 4rem; background: var(--primary-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent;"></i>
                                </div>
                                <h2 class="fw-bold">Teacher Dashboard</h2>
                                <p class="text-muted">Sign in to manage student registrations</p>
                            </div>
                            
                            <form id="loginForm">
                                <div class="mb-3">
                                    <label for="email" class="form-label fw-semibold">Email Address</label>
                                    <input 
                                        type="email" 
                                        class="form-control form-control-lg" 
                                        id="email" 
                                        placeholder="teacher@school.com"
                                        required
                                        autocomplete="username"
                                    >
                                </div>
                                
                                <div class="mb-4">
                                    <label for="password" class="form-label fw-semibold">Password</label>
                                    <div class="input-group input-group-lg">
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
                                
                                <button type="submit" class="btn btn-primary btn-lg w-100 mb-3" id="loginBtn">
                                    <i class="bi bi-box-arrow-in-right me-2"></i>
                                    Sign In
                                </button>
                                
                                <div class="text-center">
                                    <a href="index.html" class="text-muted text-decoration-none">
                                        <i class="bi bi-arrow-left me-1"></i>
                                        Back to Home
                                    </a>
                                </div>
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
        // Reset dashboard state
        dashboardInitialized = false;
        morningStudentsCount = 0;
        eveningStudentsCount = 0;
        
        // Sign out from Firebase
        await signOut(auth);
        
        // onAuthStateChanged will call showLoginScreen()
        showSuccessToast('Logged out successfully');
    } catch (error) {
        console.error('Logout error:', error);
        showErrorToast('Failed to logout. Please try again.');
    }
}

// ============================================
// DASHBOARD MAIN VIEW
// ============================================

function showDashboard() {
    // Hide login, show dashboard
    document.getElementById('loginContainer').classList.add('d-none');
    document.getElementById('dashboardContainer').classList.remove('d-none');
    
    // Set user email
    document.getElementById('userEmail').textContent = currentUser.email;
    
    // Set registration links
    const baseUrl = window.location.origin;
    document.getElementById('morningRegLink').value = `${baseUrl}/morning.html`;
    document.getElementById('eveningRegLink').value = `${baseUrl}/evening.html`;
    
    // Setup event listeners (only once)
    if (!dashboardInitialized) {
        document.getElementById('logoutBtn').addEventListener('click', handleLogout);
        document.getElementById('morningBtn').addEventListener('click', () => handleZoomLinkUpdate('morning'));
        document.getElementById('eveningBtn').addEventListener('click', () => handleZoomLinkUpdate('evening'));
        
        // Tab change listeners
        document.getElementById('morning-tab').addEventListener('shown.bs.tab', () => loadStudents('morning'));
        document.getElementById('evening-tab').addEventListener('shown.bs.tab', () => loadStudents('evening'));
        
        dashboardInitialized = true;
    }
    
    // Initialize/Refresh data
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
        
        let linksConfigured = 0;
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // Morning link
            if (data.morning) {
                document.getElementById('morningLinkInput').value = data.morning;
                updateLinkButton('morning', 'update');
                linksConfigured++;
                if (data.morningLastUpdated) {
                    updateLastUpdatedText('morning', data.morningLastUpdated.toDate());
                }
            }
            
            // Evening link
            if (data.evening) {
                document.getElementById('eveningLinkInput').value = data.evening;
                updateLinkButton('evening', 'update');
                linksConfigured++;
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
        
        // Update zoom links status
        document.getElementById('zoomLinksStatus').textContent = `${linksConfigured}/2`;
        
    } catch (error) {
        console.error('Error loading zoom links:', error);
        showErrorToast('Failed to load Zoom links');
    }
}

function updateLinkButton(session, mode) {
    const btn = document.getElementById(`${session}Btn`);
    
    if (mode === 'update') {
        btn.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i> Update Link';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
    } else {
        btn.innerHTML = '<i class="bi bi-plus-circle me-1"></i> Add Link';
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
    el.innerHTML = `<i class="bi bi-clock me-1"></i> Last updated: ${formatted}`;
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
        
        // Reload to update stats
        await loadZoomLinks();
        
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
        // Use students subcollection under each session
        const studentsRef = collection(db, 'sessions', session, 'students');
        console.debug('loadStudents - querying path:', studentsRef.path || `${'sessions/' + session + '/students'}`);
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
            const dateA = a.registeredAt?.toMillis ? a.registeredAt.toMillis() : (a.registeredAt?.toDate ? a.registeredAt.toDate().getTime() : 0);
            const dateB = b.registeredAt?.toMillis ? b.registeredAt.toMillis() : (b.registeredAt?.toDate ? b.registeredAt.toDate().getTime() : 0);
            return dateB - dateA;
        });
        
        // Update counts
        if (session === 'morning') {
            morningStudentsCount = students.length;
            document.getElementById('morningCount').textContent = students.length;
            document.getElementById('morningStatCount').textContent = students.length;
        } else {
            eveningStudentsCount = students.length;
            document.getElementById('eveningCount').textContent = students.length;
            document.getElementById('eveningStatCount').textContent = students.length;
        }
        
        // Update total
        document.getElementById('totalStatCount').textContent = morningStudentsCount + eveningStudentsCount;
        
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
                <h6 class="fw-bold mb-2">
                    <i class="bi bi-info-circle me-2"></i>
                    No students registered for ${session} session yet
                </h6>
                <p class="mb-3">Share the registration link with your students to get started:</p>
                <div class="input-group">
                    <input type="text" class="form-control" value="${window.location.origin}/${session}.html" readonly>
                    <button class="btn copy-link-btn" onclick="copyToClipboard('${session}RegLink')">
                        <i class="bi bi-clipboard me-1"></i> Copy
                    </button>
                </div>
            </div>
        `;
        return;
    }
    
    let tableHTML = `
        <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
                <thead class="table-dark">
                    <tr>
                        <th style="width: 40px;">#</th>
                        <th>Student Name</th>
                        <th>Parent Phone</th>
                        <th>Class</th>
                        <th>Subjects</th>
                        <th style="width: 200px;">Payment Receipt</th>
                        <th style="width: 150px;">Registered</th>
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
                    <div class="d-flex align-items-center gap-2">
                        <div class="bg-primary bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center" style="width: 40px; height: 40px;">
                            <strong class="text-primary">${escapeHtml(student.studentName.charAt(0).toUpperCase())}</strong>
                        </div>
                        <strong>${escapeHtml(student.studentName)}</strong>
                    </div>
                </td>
                <td>
                    <code class="bg-light px-2 py-1 rounded">${escapeHtml(student.parentPhone)}</code>
                </td>
                <td>
                    <span class="badge bg-primary">${escapeHtml(student.class)}</span>
                </td>
                <td>
                    <small class="text-muted">${escapeHtml(student.subjects)}</small>
                </td>
                <td>
                    <small class="text-muted" style="display: block; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" 
                           title="${escapeHtml(student.receiptMessage)}">
                        ${escapeHtml(student.receiptMessage)}
                    </small>
                </td>
                <td>
                    <small class="text-muted">${regDate}</small>
                </td>
                <td>
                    <button class="btn btn-danger btn-sm table-action-btn" 
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
        
        <div class="d-flex justify-content-between align-items-center mt-3 p-3 bg-light rounded">
            <span class="text-muted">
                <i class="bi bi-people me-1"></i>
                Total: <strong>${students.length}</strong> student${students.length !== 1 ? 's' : ''}
            </span>
            <button class="btn btn-outline-primary btn-sm" onclick="exportToCSV('${session}')">
                <i class="bi bi-download me-1"></i>
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
    
    // Show loading toast
    showLoadingToast('Deleting student...');
    
    try {
        // Delete from students subcollection
        const docRef = doc(db, 'sessions', session, 'students', phoneNumber);
        console.debug('deleteStudent - deleting path:', docRef.path);
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
        
        // Use students subcollection under the session document
        const studentsRef = collection(db, 'sessions', session, 'students');
        console.debug('exportToCSV - querying path:', studentsRef.path || `${'sessions/' + session + '/students'}`);
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
            csv += `"${student.receiptMessage.replace(/"/g, '""')}",`;
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
