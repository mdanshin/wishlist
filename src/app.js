import { auth, provider, db } from './firebase.js';
import { signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { doc, getDoc, setDoc, collection, addDoc, getDocs } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

const loginBtn = document.getElementById('login');
const logoutBtn = document.getElementById('logout');
const userInfo = document.getElementById('user-info');
const userName = document.getElementById('user-name');
const userEmail = document.getElementById('user-email');
const wishlistSection = document.getElementById('wishlist-section');
const itemInput = document.getElementById('item-input');
const addItemBtn = document.getElementById('add-item');
const itemsList = document.getElementById('items');

loginBtn.addEventListener('click', async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (err) {
        console.error('Sign-in error', err);
        alert('Ошибка входа: ' + err.message);
    }
});

logoutBtn.addEventListener('click', async () => {
    await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = '';
        userInfo.style.display = '';
        wishlistSection.style.display = '';
        userName.textContent = user.displayName || '';
        userEmail.textContent = user.email || '';

        // Ensure user doc exists
        const userDocRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userDocRef);
        if (!snap.exists()) {
            await setDoc(userDocRef, {
                name: user.displayName || '',
                email: user.email || '',
                createdAt: new Date().toISOString()
            });
        }

        await loadWishlist(user.uid);
    } else {
        loginBtn.style.display = '';
        logoutBtn.style.display = 'none';
        userInfo.style.display = 'none';
        wishlistSection.style.display = 'none';
        userName.textContent = '';
        userEmail.textContent = '';
        itemsList.innerHTML = '';
    }
});

addItemBtn.addEventListener('click', async () => {
    const text = itemInput.value.trim();
    const user = auth.currentUser;
    if (!user) return alert('Сначала войдите');
    if (!text) return;
    try {
        const colRef = collection(db, 'users', user.uid, 'wishlist');
        await addDoc(colRef, { text, createdAt: new Date().toISOString() });
        itemInput.value = '';
        await loadWishlist(user.uid);
    } catch (err) {
        console.error(err);
        alert('Не удалось добавить: ' + err.message);
    }
});

async function loadWishlist(uid) {
    itemsList.innerHTML = '';
    const colRef = collection(db, 'users', uid, 'wishlist');
    try {
        const snap = await getDocs(colRef);
        snap.forEach(docSnap => {
            const li = document.createElement('li');
            li.textContent = docSnap.data().text || '(empty)';
            itemsList.appendChild(li);
        });
    } catch (err) {
        console.error('Load wishlist error', err);
    }
}