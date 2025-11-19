// Firebase Configuration
// Import Firebase SDKs
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDdtdrGxCKjoyEBE_5XRVYPDQAu8CPn5YQ",
  authDomain: "online-tutoring-6d71a.firebaseapp.com",
  projectId: "online-tutoring-6d71a",
  storageBucket: "online-tutoring-6d71a.firebasestorage.app",
  messagingSenderId: "896061311479",
  appId: "1:896061311479:web:77b180664b9f702ca406f2",
  measurementId: "G-KZLESXTLPX"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const db = getFirestore(app);
export const auth = getAuth(app);

// Export app for other uses
export default app;

console.log('Firebase initialized successfully', { projectId: app.options?.projectId });

// Quick connectivity & permissions test: attempt to read config/zoomLinks and log result.
(async () => {
    try {
        const testRef = doc(db, 'config', 'zoomLinks');
        const snap = await getDoc(testRef);
        console.log('Firestore test read: config/zoomLinks exists =', snap.exists());
    } catch (err) {
        console.error('Firestore connectivity test failed:', err);
    }
})();
