// src/firebaseDB.js

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where
} from 'firebase/firestore'; // ✅ Importaciones agrupadas y arriba del todo

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
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Funciones para trabajar con agentes
export const obtenerAgentes = async () => {
  const agentesRef = collection(db, "agentes");
  const snapshot = await getDocs(agentesRef);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const crearAgente = async (nuevoAgente) => {
  const agentesRef = collection(db, "agentes");
  await addDoc(agentesRef, nuevoAgente);
};

export const actualizarAgente = async (id, datosActualizados) => {
  const agenteRef = doc(db, "agentes", id);
  await updateDoc(agenteRef, datosActualizados);
};

export const eliminarAgente = async (id) => {
  const agenteRef = doc(db, "agentes", id);
  await deleteDoc(agenteRef);
};

export const escucharAgentes = (callback) => {
  const agentesRef = collection(db, "agentes");
  return onSnapshot(agentesRef, (snapshot) => {
    const lista = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    callback(lista);
  });
};

export const escucharConversacionesRecientes = (callback) => {
  const ref = collection(db, "conversaciones");

  return onSnapshot(ref, (snapshot) => {
    const lista = snapshot.docs
      .map(doc => ({
        userId: doc.id, // ✅ Necesario para que Conversaciones.jsx lo use
        ...doc.data()
      }))
      .filter(c =>
        (c.estado || "").toLowerCase() !== "cerrado" &&
        (c.estado || "").toLowerCase() !== "archivado"
      );

    callback(lista);
  });
};

export const escucharMensajesUsuario = (userId, callback) => {
  const mensajesRef = collection(db, "conversaciones", userId, "mensajes");

  return onSnapshot(mensajesRef, (snapshot) => {
    const lista = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    callback(lista);
  });
};

// ✅ Exportaciones explícitas para otros módulos del panel
export { app, db };

// ✅ Exportación al window para uso en scripts planos como main.js
window.firestore = {
  db,
  collection,
  query,
  where,
  onSnapshot
};
