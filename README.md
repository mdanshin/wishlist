# Wishlist Project

## Overview
The Wishlist project is a web application that allows users to create and manage their personal wishlists. It implements Google authentication for user sign-in and stores user data in Firebase.

## Project Structure
```
wishlist
├── index.html
├── src
│   ├── app.js
│   ├── firebase.js
│   └── styles.css
├── package.json
├── .gitignore
└── README.md
```

## Features
- Google authentication for secure user sign-in.
- User data is stored in Firebase, allowing for easy retrieval and management.
- Responsive design with custom styles.

## Setup Instructions

1. **Clone the Repository**
   ```bash
   git clone <repository-url>
   cd wishlist
   ```

2. **Install Dependencies**
   Make sure you have Node.js installed. Then run:
   ```bash
   npm install
   ```

3. **Configure Firebase**
   - Create a Firebase project at [Firebase Console](https://console.firebase.google.com/).
   - Add your web app to the Firebase project and copy the configuration details.
   - Update the `src/firebase.js` file with your Firebase configuration.

4. **Enable Google Authentication**
   - In the Firebase Console, navigate to Authentication > Sign-in method.
   - Enable Google as a sign-in provider.

5. **Run the Application**
   You can use a simple HTTP server to serve the application. For example, you can use `http-server`:
   ```bash
   npx http-server .
   ```

6. **Deploy to GitHub Pages**
   - Push your code to a GitHub repository.
   - Go to the repository settings and enable GitHub Pages from the `main` branch.

## Usage
- Users can sign in using their Google account.
- Once signed in, users can add, view, and manage their wishlists.

## License
This project is licensed under the MIT License. See the LICENSE file for details.