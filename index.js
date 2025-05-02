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
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const app = express();
const PORT = process.env.PORT || 3000;
const HISTORIAL_PATH = "./historial.json";

let conversaciones = [];
let intervenidas = {};
let vistasPorAgente = {};

if (fs.existsSync(HISTORIAL_PATH)) {
  const data = JSON.parse(fs.readFileSync(HISTORIAL_PATH, "utf8"));
  conversaciones = data.conversaciones || [];
  intervenidas = data.intervenidas || {};
  vistasPorAgente = data.vistasPorAgente || {};
}

function guardarConversaciones() {
  fs.writeFileSync(
    HISTORIAL_PATH,
    JSON.stringify({ conversaciones, intervenidas, vistasPorAgente }, null, 2)
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
      {
        role: "system",
        content: `Traduce el siguiente texto al idioma "${target}" sin explicar nada, solo la traducción.`,
      },
      { role: "user", content: texto },
    ],
  });
  return res.choices[0].message.content.trim();
}

function detectarIdioma(texto) {
  if (/[áéíóúñü]/i.test(texto)) return "es";
  if (/[぀-ヿ]/.test(texto)) return "ja";
  if (/[一-龥]/.test(texto)) return "zh";
  if (/\b(the|you|and|hello|please|thank)\b/i.test(texto)) return "en";
  if (/[а-яА-Я]/.test(texto)) return "ru";
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

    await db.collection("mensajes").add({
      idConversacion: userId,
      rol: "usuario",
      mensaje: imageUrl,
      tipo: "imagen",
      timestamp: new Date().toISOString(),
    });

    res.json({ imageUrl });
  } catch (error) {
    console.error("❌ Error procesando imagen:", error);
    res.status(500).json({ error: "Error procesando la imagen" });
  }
});
app.post("/api/chat", async (req, res) => {
  const { message, system, userId, userAgent, pais, historial } = req.body;
  const finalUserId = userId || "anon";
  const idioma = detectarIdioma(message);

  try {
    await db.collection("usuarios_chat").doc(finalUserId).set(
      {
        nombre: "Invitado",
        idioma: idioma || "es",
        ultimaConexion: new Date().toISOString(),
        navegador: userAgent || "",
        pais: pais || "",
        historial: historial || [],
      },
      { merge: true }
    );

    await db.collection("conversaciones").doc(finalUserId).set(
      {
        idUsuario: finalUserId,
        fechaInicio: new Date().toISOString(),
        estado: "abierta",
        idioma: idioma || "es",
        navegador: userAgent || "",
        pais: pais || "",
        historial: historial || [],
      },
      { merge: true }
    );

    const traduccionUsuario = await traducir(message, "es");

    await db.collection("mensajes").add({
      idConversacion: finalUserId,
      rol: "usuario",
      mensaje: traduccionUsuario,
      original: message,
      tipo: "texto",
      timestamp: new Date().toISOString(),
    });

    if (shouldEscalateToHuman(message)) {
      await sendToSlack(`⚠️ [${finalUserId}] pide ayuda humana:\n${message}`, finalUserId);
      return res.json({
        reply: "Voy a derivar tu solicitud a un agente humano. Por favor, espera mientras se realiza la transferencia.",
      });
    }

    if (intervenidas[finalUserId]) return res.json({ reply: null });

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: system || `Eres un asistente de soporte funerario. Responde en el mismo idioma que el usuario.`,
        },
        { role: "user", content: message },
      ],
    });

    const reply = response.choices[0].message.content;
    const traduccionRespuesta = await traducir(reply, idioma);

    await db.collection("mensajes").add({
      idConversacion: finalUserId,
      rol: "asistente",
      mensaje: traduccionRespuesta,
      original: reply,
      tipo: "texto",
      timestamp: new Date().toISOString(),
    });

    await sendToSlack(`👤 [${finalUserId}] ${message}\n🤖 ${reply}`, finalUserId);

    res.json({ reply });
  } catch (error) {
    console.error("❌ Error general en /api/chat:", error);
    res.status(500).json({ reply: "Lo siento, ocurrió un error." });
  }
});

app.post("/api/send-to-user", async (req, res) => {
  const { userId, message, agente } = req.body;
  if (!userId || !message || !agente)
    return res.status(400).json({ error: "Faltan datos" });

  let tiempoRespuesta = null;
  try {
    const snapshot = await db
      .collection("mensajes")
      .where("idConversacion", "==", userId)
      .where("rol", "==", "usuario")
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();

    if (!snapshot.empty) {
      const ultimoMensajeUsuario = snapshot.docs[0].data();
      const fechaUsuario = new Date(ultimoMensajeUsuario.timestamp);
      const fechaAhora = new Date();
      tiempoRespuesta = (fechaAhora - fechaUsuario) / 1000;
    }
  } catch (e) {
    console.warn(`⚠️ No se pudo calcular tiempoRespuesta para ${userId}`);
  }

  await db.collection("mensajes").add({
    idConversacion: userId,
    rol: "asistente",
    mensaje: message,
    tipo: "texto",
    timestamp: new Date().toISOString(),
    manual: true,
    original: null,
    agenteUid: agente.uid || null,
    tiempoRespuesta: tiempoRespuesta,
  });

  intervenidas[userId] = true;

  await db.collection("conversaciones").doc(userId).set(
    {
      intervenida: true,
      intervenidaPor: {
        nombre: agente.nombre,
        foto: agente.foto,
        uid: agente.uid || null
      },
    },
    { merge: true }
  );

  if (!slackResponses.has(userId)) slackResponses.set(userId, []);
  slackResponses.get(userId).push(message);

  res.json({ ok: true });
});
app.post("/api/marcar-visto", async (req, res) => {
  const { userId } = req.body;
  if (!userId)
    return res.status(400).json({ error: "Falta el userId" });

  try {
    await db.collection("vistas_globales").doc(userId).set({
      timestamp: new Date().toISOString(),
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ Error en /api/marcar-visto:", e);
    res.status(500).json({ error: "Error en marcar-visto" });
  }
});

app.get("/api/vistas", async (req, res) => {
  try {
    const snapshot = await db.collection("vistas_globales").get();
    const result = {};
    snapshot.forEach((doc) => {
      result[doc.id] = doc.data().timestamp;
    });
    res.json(result);
  } catch (error) {
    console.error("❌ Error obteniendo vistas:", error);
    res.status(500).json({ error: "Error obteniendo vistas" });
  }
});

app.get("/api/conversaciones", async (req, res) => {
  try {
    const snapshot = await db.collection("conversaciones").get();
    const conversaciones = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const data = doc.data();
        const userId = data.idUsuario;
        if (!userId) return null;

        let lastInteraction = data.fechaInicio;
        let lastMessageText = "";
        let mensajes = [];

        try {
          const mensajesSnapshot = await db
            .collection("mensajes")
            .where("idConversacion", "==", userId)
            .orderBy("timestamp", "desc")
            .limit(20)
            .get();

          mensajes = mensajesSnapshot.docs.map((d) => {
            const m = d.data();
            return {
              from: m.rol,
              lastInteraction: m.timestamp,
              message: m.mensaje,
              original: m.original || null,
              tipo: m.tipo || "texto",
              manual: m.manual || false,
            };
          });

          if (mensajes[0]) {
            lastInteraction = mensajes[0].lastInteraction;
            lastMessageText = mensajes[0].message;
          }
        } catch (e) {
          console.warn(`⚠️ No se pudo cargar mensajes para ${userId}`);
        }

        return {
          userId,
          lastInteraction,
          estado: data.estado || "abierta",
          intervenida: data.intervenida || false,
          intervenidaPor: data.intervenidaPor || null,
          pais: data.pais || "🌐",
          navegador: data.navegador || "Desconocido",
          historial: data.historial || [],
          message: lastMessageText,
          mensajes,
        };
      })
    );

    const limpias = conversaciones.filter((c) => !!c);
    res.json(limpias);
  } catch (error) {
    console.error("❌ Error obteniendo conversaciones:", error);
    res.status(500).json({ error: "Error obteniendo conversaciones" });
  }
});

app.get("/api/conversaciones/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const mensajesSnapshot = await db
      .collection("mensajes")
      .where("idConversacion", "==", userId)
      .orderBy("timestamp")
      .get();

    const mensajes = mensajesSnapshot.docs
      .map((doc) => {
        const data = doc.data();
        if (!data || !data.timestamp || !data.mensaje || !data.rol) {
          console.error("⚠️ Mensaje inválido detectado:", doc.id, data);
          return null;
        }
        return {
          userId,
          lastInteraction: data.timestamp,
          message: data.mensaje,
          original: data.original || null,
          from: data.rol,
          tipo: data.tipo || "texto",
        };
      })
      .filter((msg) => msg !== null);

    res.json(mensajes);
  } catch (error) {
    console.error("❌ Error crítico obteniendo mensajes:", error);
    res.status(500).json({ error: "Error crítico obteniendo mensajes" });
  }
});

app.get("/api/mensajes-agente/:uid", async (req, res) => {
  const { uid } = req.params;

  try {
    const snapshot = await db
      .collection("mensajes")
      .where("manual", "==", true)
      .where("agenteUid", "==", uid)
      .orderBy("timestamp", "desc")
      .limit(100)
      .get();

    const mensajes = snapshot.docs.map((doc) => doc.data());
    res.json({
      mensajes,
      perfil: await obtenerPerfilAgente(uid),
    });
  } catch (error) {
    console.error("❌ Error obteniendo mensajes de agente:", error);
    res.status(500).json({ error: "Error obteniendo mensajes de agente" });
  }
});

async function obtenerPerfilAgente(uid) {
  try {
    const docSnap = await db.collection("agentes").doc(uid).get();
    if (docSnap.exists) return docSnap.data();
    return null;
  } catch (e) {
    console.warn(`⚠️ No se pudo cargar perfil de agente ${uid}`);
    return null;
  }
}

app.get("/api/poll/:userId", (req, res) => {
  const mensajes = slackResponses.get(req.params.userId) || [];
  slackResponses.set(req.params.userId, []);
  res.json({ mensajes });
});

// ✅ ÚNICO CAMBIO: añadimos 0.0.0.0 para Railway
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT} en 0.0.0.0`);
});
