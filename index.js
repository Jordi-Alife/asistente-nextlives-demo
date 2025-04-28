// index.js completo actualizado

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import admin from "firebase-admin";
import serviceAccount from "./serviceAccountKey.json" assert { type: "json" };
import sharp from "sharp";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
const PORT = process.env.PORT || 3000;
const HISTORIAL_PATH = "./historial.json";

let conversaciones = [];
let vistas = {};
let intervenidas = {};

if (fs.existsSync(HISTORIAL_PATH)) {
  const data = JSON.parse(fs.readFileSync(HISTORIAL_PATH, "utf8"));
  conversaciones = data.conversaciones || [];
  vistas = data.vistas || {};
  intervenidas = data.intervenidas || {};
}

function guardarConversaciones() {
  fs.writeFileSync(
    HISTORIAL_PATH,
    JSON.stringify({ conversaciones, vistas, intervenidas }, null, 2)
  );
}

const slackResponses = new Map();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function traducir(texto, target = "es") {
  const res = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: `Traduce al idioma \"${target}\" sin explicar nada.` },
      { role: "user", content: texto },
    ],
  });
  return res.choices[0].message.content.trim();
}

function detectarIdioma(texto) {
  if (/[áéíóúñü]/i.test(texto)) return "es";
  if (/\b(the|you|and|hello|please|thank)\b/i.test(texto)) return "en";
  return "es";
}

async function sendToSlack(message, userId = null) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  const text = userId ? `[${userId}] ${message}` : message;
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

function shouldEscalateToHuman(message) {
  const lower = message.toLowerCase();
  return lower.includes("humano") || lower.includes("persona");
}

// >>> SUBIDA DE ARCHIVOS
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió imagen" });
  const imagePath = req.file.path;
  const optimizedPath = `uploads/optimized-${req.file.filename}`;
  const userId = req.body.userId || "desconocido";
  try {
    await sharp(imagePath).resize({ width: 800 }).jpeg({ quality: 80 }).toFile(optimizedPath);
    const imageUrl = `${req.protocol}://${req.get("host")}/${optimizedPath}`;
    await db.collection('mensajes').add({
      idConversacion: userId,
      rol: "usuario",
      mensaje: imageUrl,
      tipo: "imagen",
      timestamp: new Date().toISOString()
    });
    res.json({ imageUrl });
  } catch (error) {
    console.error("Error subiendo imagen:", error);
    res.status(500).json({ error: "Error procesando imagen" });
  }
});

// >>> CHAT PRINCIPAL
app.post("/api/chat", async (req, res) => {
  const { message, system, userId } = req.body;
  const finalUserId = userId || "anon";
  const idioma = detectarIdioma(message);

  await db.collection('usuarios_chat').doc(finalUserId).set({
    nombre: "Invitado",
    idioma,
    ultimaConexion: new Date().toISOString()
  }, { merge: true });

  await db.collection('conversaciones').doc(finalUserId).set({
    idUsuario: finalUserId,
    fechaInicio: new Date().toISOString(),
    estado: "abierta",
    idioma
  }, { merge: true });

  await db.collection('mensajes').add({
    idConversacion: finalUserId,
    rol: "usuario",
    mensaje: message,
    tipo: "texto",
    timestamp: new Date().toISOString()
  });

  if (shouldEscalateToHuman(message)) {
    await sendToSlack(`⚠️ [${finalUserId}] pide ayuda humana.`, finalUserId);
    return res.json({ reply: "Te paso con un agente humano." });
  }

  const respuesta = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: system || "Eres asistente de soporte." },
      { role: "user", content: message },
    ],
  });
  const reply = respuesta.choices[0].message.content;

  await db.collection('mensajes').add({
    idConversacion: finalUserId,
    rol: "asistente",
    mensaje: reply,
    tipo: "texto",
    timestamp: new Date().toISOString()
  });

  await sendToSlack(`👤 [${finalUserId}] ${message}\n🤖 ${reply}`, finalUserId);

  res.json({ reply });
});

// >>> ENVIAR DESDE PANEL
app.post("/api/send-to-user", async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: "Faltan datos" });
  await db.collection('mensajes').add({
    idConversacion: userId,
    rol: "asistente",
    mensaje: message,
    tipo: "texto",
    timestamp: new Date().toISOString()
  });
  intervenidas[userId] = true;
  res.json({ ok: true });
});

// >>> MARCAR COMO VISTO
app.post("/api/marcar-visto", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Falta userId" });
  vistas[userId] = new Date().toISOString();
  guardarConversaciones();
  res.json({ ok: true });
});

// >>> GET CONVERSACIONES
app.get("/api/conversaciones", async (req, res) => {
  try {
    const snapshot = await db.collection('conversaciones').get();
    const conversaciones = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        userId: data.idUsuario,
        lastInteraction: data.fechaInicio,
        estado: data.estado || "abierta",
        message: ""
      };
    });
    res.json(conversaciones);
  } catch (error) {
    console.error("Error conversaciones:", error);
    res.status(500).json({ error: "Error conversaciones" });
  }
});

// >>> GET MENSAJES POR USUARIO CON DEBUG
app.get("/api/conversaciones/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const mensajesSnapshot = await db.collection('mensajes')
      .where('idConversacion', '==', userId)
      .orderBy('timestamp')
      .get();

    if (mensajesSnapshot.empty) {
      console.log(`No hay mensajes para ${userId}`);
      return res.json([]);
    }

    const mensajes = mensajesSnapshot.docs.map(doc => {
      const data = doc.data();
      console.log("Mensaje recuperado:", data);
      return {
        userId,
        lastInteraction: data.timestamp,
        message: data.mensaje,
        from: data.rol,
        tipo: data.tipo || "texto"
      };
    });

    res.json(mensajes);
  } catch (error) {
    console.error("Error obteniendo mensajes:", error);
    res.status(500).json({ error: "Error obteniendo mensajes" });
  }
});

// >>> POLL
app.get("/api/poll/:userId", (req, res) => {
  const mensajes = slackResponses.get(req.params.userId) || [];
  slackResponses.set(req.params.userId, []);
  res.json({ mensajes });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
