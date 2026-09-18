// Firebase configuration shared between services
import * as firebase from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error(
    'Firebase is not configured. Copy .env.example to .env.local and set VITE_FIREBASE_* values.'
  );
}

const app = firebase.initializeApp(firebaseConfig);

export const firestore = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

/** Secondary Auth instance so admins can create users without replacing their own session. */
export const getSecondaryAuth = (): Auth => {
  const existing = firebase.getApps().find((a) => a.name === 'Secondary');
  const secondaryApp = existing ?? firebase.initializeApp(firebaseConfig, 'Secondary');
  return getAuth(secondaryApp);
};

export { app, firebaseConfig };
