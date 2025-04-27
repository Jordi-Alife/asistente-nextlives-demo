// >>> INICIO DEL ARCHIVO

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
      { role: "system", content: `Traduce el siguiente texto al idioma "${target}" sin explicar nada, solo la traducción.` },
      { role: "user", content: texto },
    ],
  });
  return res.choices[0].message.content.trim();
}

function detectarIdioma(texto) {
  if (/[áéíóúñü]/i.test(texto)) return "es";
  if (/[\u3040-\u30ff]/.test(texto)) return "ja";
  if (/[\u4e00-\u9fa5]/.test(texto)) return "zh";
  if (/\b(the|you|and|hello|please|thank)\b/i.test(texto)) return "en";
  if (/[а-яА-ЯёЁ]/.test(texto)) return "ru";
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
  return (
    lower.includes("hablar con una persona") ||
    lower.includes("quiero hablar con un humano") ||
    lower.includes("necesito ayuda humana") ||
    lower.includes("pasame con un humano") ||
    lower.includes("quiero hablar con alguien") ||
    lower.includes("agente humano")
  );
}

// >>> SUBIDA DE ARCHIVOS
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });

  const imagePath = req.file.path;
  const optimizedPath = `uploads/optimized-${req.file.filename}`;
  const userId = req.body.userId || "desconocido";

  try {
    await sharp(imagePath)
      .resize({ width: 800 })
      .jpeg({ quality: 80 })
      .toFile(optimizedPath);

    const imageUrl = `${req.protocol}://${req.get("host")}/${optimizedPath}`;

    await sendToSlack(`🖼️ Imagen subida por usuario [${userId}]: ${imageUrl}`);

    await db.collection('mensajes').add({
      idConversacion: userId,
      rol: "usuario",
      mensaje: imageUrl,
      tipo: "imagen",
      timestamp: new Date().toISOString()
    });

    res.json({ imageUrl });
  } catch (error) {
    console.error("❌ Error procesando imagen:", error);
    res.status(500).json({ error: "Error procesando la imagen" });
  }
});

// >>> CHAT PRINCIPAL
app.post("/api/chat", async (req, res) => {
  const { message, system, userId } = req.body;
  const finalUserId = userId || "anon";
  const idioma = detectarIdioma(message);

  try {
    const refUsuario = db.collection('usuarios_chat').doc(finalUserId);
    const docUsuario = await refUsuario.get();
    if (!docUsuario.exists) {
      await refUsuario.set({
        nombre: "Invitado",
        idioma: idioma || "es",
        ultimaConexion: new Date().toISOString()
      });
    } else {
      await refUsuario.update({
        ultimaConexion: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error("❌ Error guardando usuario:", error);
  }

  try {
    const refConversacion = db.collection('conversaciones').doc(finalUserId);
    const docConversacion = await refConversacion.get();
    if (!docConversacion.exists) {
      await refConversacion.set({
        idUsuario: finalUserId,
        fechaInicio: new Date().toISOString(),
        estado: "abierta",
        idioma: idioma || "es"
      });
    }
  } catch (error) {
    console.error("❌ Error guardando conversación:", error);
  }

  try {
    await db.collection('mensajes').add({
      idConversacion: finalUserId,
      rol: "usuario",
      mensaje: message,
      tipo: "texto",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Error guardando mensaje:", error);
  }

  const traduccionUsuario = await traducir(message, "es");

  if (shouldEscalateToHuman(message)) {
    await sendToSlack(`⚠️ [${finalUserId}] pide ayuda humana:\n${message}`, finalUserId);
    return res.json({ reply: "Voy a derivar tu solicitud a un agente humano. Por favor, espera mientras se realiza la transferencia." });
  }

  if (intervenidas[finalUserId]) {
    return res.json({ reply: null });
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: system || `Eres un asistente de soporte funerario. Responde en el mismo idioma que el usuario.` },
        { role: "user", content: message },
      ],
    });

    const reply = response.choices[0].message.content;

    await db.collection('mensajes').add({
      idConversacion: finalUserId,
      rol: "asistente",
      mensaje: reply,
      tipo: "texto",
      timestamp: new Date().toISOString()
    });

    await sendToSlack(`👤 [${finalUserId}] ${message}\n🤖 ${reply}`, finalUserId);

    res.json({ reply });
  } catch (err) {
    console.error("Error GPT:", err);
    res.status(500).json({ reply: "Lo siento, ocurrió un error al procesar tu mensaje." });
  }
});

// >>> ENVIAR DESDE PANEL
app.post("/api/send-to-user", express.json(), async (req, res) => {
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

  if (!slackResponses.has(userId)) slackResponses.set(userId, []);
  slackResponses.get(userId).push(message);

  console.log(`📨 Mensaje manual enviado a [${userId}]`);
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

// >>>>>> CORRECTO API CONVERSACIONES
app.get("/api/conversaciones", async (req, res) => {
  try {
    const snapshot = await db.collection('conversaciones').get();
    const conversaciones = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      conversaciones.push({
        userId: data.idUsuario,
        lastInteraction: data.fechaInicio,
        estado: data.estado || "abierta",
        message: ""
      });
    }

    res.json(conversaciones);
  } catch (error) {
    console.error("❌ Error obteniendo conversaciones:", error);
    res.status(500).json({ error: "Error obteniendo conversaciones" });
  }
});

// >>>>>> CORRECTO API MENSAJES POR USUARIO
app.get("/api/conversaciones/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const mensajesSnapshot = await db.collection('mensajes')
      .where('idConversacion', '==', userId)
      .orderBy('timestamp')
      .get();

    const mensajes = mensajesSnapshot.docs.map(doc => {
      const data = doc.data();
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
    console.error("❌ Error obteniendo mensajes:", error);
    res.status(500).json({ error: "Error obteniendo mensajes" });
  }
});

app.get("/api/vistas", (req, res) => res.json(vistas));

app.get("/api/poll/:userId", (req, res) => {
  const mensajes = slackResponses.get(req.params.userId) || [];
  slackResponses.set(req.params.userId, []);
  res.json({ mensajes });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor asistente escuchando en puerto ${PORT}`);
});

// >>> FIN DEL ARCHIVO
