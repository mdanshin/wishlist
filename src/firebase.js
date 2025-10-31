// Modular Firebase initialization using CDN imports
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBWKwug69lRiWKZQ7vhMzTFLoxwFzDZhQA",
  authDomain: "wishlist-962cf.firebaseapp.com",
  projectId: "wishlist-962cf",
  storageBucket: "wishlist-962cf.appspot.com",
  messagingSenderId: "665872423891"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);