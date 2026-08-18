const {
  getApps,
  initializeApp,
  cert,
} = require('firebase-admin/app');

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,

  clientEmail:
    process.env.FIREBASE_CLIENT_EMAIL,

  privateKey:
    process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined,
};

let firebaseApp;

if (getApps().length === 0) {
  firebaseApp = initializeApp({
    credential: cert(serviceAccount),
  });
} else {
  firebaseApp = getApps()[0];
}

module.exports = firebaseApp;