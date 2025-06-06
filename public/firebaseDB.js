// firebaseDB.js (adaptado para <script> en HTML, no modules)
importScripts("https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js");

// Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyB0vz-jtc7PRpdFfQUKvU9PevLEV8zYzO4",
  authDomain: "nextlives-panel-soporte.firebaseapp.com",
  projectId: "nextlives-panel-soporte",
  storageBucket: "nextlives-panel-soporte.appspot.com",
  messagingSenderId: "52725281576",
  appId: "1:52725281576:web:4402c0507962074345161d"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Exponer funciones necesarias en window.firestore
window.firestore = {
  db,
  collection: firebase.firestore().collection,
  doc: firebase.firestore().doc,
  query: firebase.firestore().query,
  where: firebase.firestore().where,
  onSnapshot: firebase.firestore().onSnapshot
};
