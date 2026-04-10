// config/firebase.js — إعداد Firebase Admin SDK
const admin = require('firebase-admin');

// في الـ production: استخدم service account key من ملف JSON
// في الـ development: استخدم environment variables
const initFirebase = () => {
  if (admin.apps.length > 0) return admin.app();

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID || 'wassalni--app',
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
      };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://wassalni--app-default-rtdb.firebaseio.com',
    projectId: process.env.FIREBASE_PROJECT_ID || 'wassalni--app',
  });

  console.log('✅ Firebase Admin SDK initialized');
  return admin.app();
};

const getFirestore = () => {
  initFirebase();
  return admin.firestore();
};

const getAuth = () => {
  initFirebase();
  return admin.auth();
};

module.exports = { initFirebase, getFirestore, getAuth, admin };
