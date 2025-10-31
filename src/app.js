const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

document.getElementById('googleSignIn').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then((result) => {
        const user = result.user;
        console.log('User signed in:', user);
        saveUserData(user);
    }).catch((error) => {
        console.error('Error during sign-in:', error);
    });
});

document.getElementById('signOut').addEventListener('click', () => {
    auth.signOut().then(() => {
        console.log('User signed out');
    }).catch((error) => {
        console.error('Error during sign-out:', error);
    });
});

auth.onAuthStateChanged((user) => {
    if (user) {
        console.log('User is signed in:', user);
        // Load user data from Firestore
        loadUserData(user.uid);
    } else {
        console.log('No user is signed in');
    }
});

function saveUserData(user) {
    db.collection('users').doc(user.uid).set({
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL
    }).then(() => {
        console.log('User data saved to Firestore');
    }).catch((error) => {
        console.error('Error saving user data:', error);
    });
}

function loadUserData(uid) {
    db.collection('users').doc(uid).get().then((doc) => {
        if (doc.exists) {
            console.log('User data retrieved:', doc.data());
        } else {
            console.log('No user data found');
        }
    }).catch((error) => {
        console.error('Error retrieving user data:', error);
    });
}