// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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
const analytics = getAnalytics(app);