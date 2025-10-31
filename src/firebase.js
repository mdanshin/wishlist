// Modular Firebase initialization using CDN imports
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyAGLAP1aQh9ZCTIYRz3y_wrPldnLEHssNQ",
  authDomain: "wishlist-962cf.firebaseapp.com",
  projectId: "wishlist-962cf",
  storageBucket: "wishlist-962cf.firebasestorage.app",
  messagingSenderId: "665872423891",
  appId: "1:665872423891:web:43ebec3f6f5d6880472d26",
  measurementId: "G-MC1CW8WCPP"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);