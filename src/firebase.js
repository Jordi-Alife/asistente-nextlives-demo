// src/firebase.js
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: "AIzaSyB0vz-jtc7PRpdFfQUKvU9PevLEV8zYzO4",
  authDomain: "nextlives-panel-soporte.firebaseapp.com",
  projectId: "nextlives-panel-soporte",
  storageBucket: "nextlives-panel-soporte.firebasestorage.app",
  messagingSenderId: "52725281576",
  appId: "1:52725281576:web:4402c0507962074345161d"
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

export { messaging, getToken, onMessage };
