import express from "express";
import cors from "cors";
import OpenAI from "openai";
import multer from "multer";
import path from "path";
import fs from "fs";
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
let escribiendoUsuarios = {};

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

async function detectarIdiomaGPT(texto) {
  const res = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: `Detecta el idioma exacto del siguiente texto. Devuelve solo el código ISO 639-1 de dos letras, sin explicación ni texto adicional.`,
      },
      { role: "user", content: texto },
    ],
  });
  return res.choices[0].message.content.trim().toLowerCase();
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

// NUEVO ENDPOINT PARA TRADUCIR TEXTO AL ÚLTIMO IDIOMA DETECTADO
app.post("/api/traducir-modal", async (req, res) => {
  const { userId, textos } = req.body;
  if (!userId || !Array.isArray(textos)) return res.status(400).json({ error: "Faltan datos" });

  try {
    const userDoc = await db.collection("usuarios_chat").doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    const idioma = userData?.idioma || "es";

    const traducciones = [];
    for (const texto of textos) {
      const traducido = await traducir(texto, idioma);
      traducciones.push(traducido);
    }

    res.json({ traducciones });
  } catch (error) {
    console.error("❌ Error en /api/traducir-modal:", error);
    res.status(500).json({ error: "Error traduciendo modal" });
  }
});
app.post("/api/chat", async (req, res) => {
  const { message, userId, userAgent, pais, historial, datosContexto } = req.body;
  const finalUserId = userId || "anon";
  const idioma = await detectarIdiomaGPT(message);

  try {
    await db.collection("usuarios_chat").doc(finalUserId).set(
      {
        nombre: "Invitado",
        idioma: idioma,
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
        idioma: idioma,
        navegador: userAgent || "",
        pais: pais || "",
        historial: historial || [],
        datosContexto: datosContexto || null,
      },
      { merge: true }
    );

    const traduccionUsuario = await traducir(message, "es");

    await db.collection("mensajes").add({
      idConversacion: finalUserId,
      rol: "usuario",
      mensaje: traduccionUsuario,
      original: message,
      idiomaDetectado: idioma,
      tipo: "texto",
      timestamp: new Date().toISOString(),
    });

    if (shouldEscalateToHuman(message)) {
      return res.json({
        reply: "Voy a derivar tu solicitud a un agente humano. Por favor, espera mientras se realiza la transferencia.",
      });
    }

    const baseConocimiento = fs.existsSync("./base_conocimiento_actualizado.txt")
      ? fs.readFileSync("./base_conocimiento_actualizado.txt", "utf8")
      : "";

    const promptSystem = [
      baseConocimiento,
      datosContexto ? `\nInformación adicional de contexto JSON:\n${JSON.stringify(datosContexto)}` : "",
      `IMPORTANTE: Responde siempre en el idioma detectado del usuario: "${idioma}". Si el usuario escribió en catalán, responde en catalán; si lo hizo en inglés, responde en inglés; si en español, responde en español. No traduzcas ni expliques nada adicional.`,
    ].join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: promptSystem },
        { role: "user", content: message },
      ],
    });

    const reply = response.choices[0].message.content;
    const traduccionRespuesta = await traducir(reply, "es");

    await db.collection("mensajes").add({
      idConversacion: finalUserId,
      rol: "asistente",
      mensaje: traduccionRespuesta,
      original: reply,
      idiomaDetectado: idioma,
      tipo: "texto",
      timestamp: new Date().toISOString(),
    });

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

  try {
    const mensajesSnapshot = await db
      .collection("mensajes")
      .where("idConversacion", "==", userId)
      .where("rol", "==", "usuario")
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();

    let idiomaDestino = "es";
    if (!mensajesSnapshot.empty) {
      const ultimoMensaje = mensajesSnapshot.docs[0].data();
      idiomaDestino = ultimoMensaje.idiomaDetectado || await detectarIdiomaGPT(ultimoMensaje.original || ultimoMensaje.mensaje) || "es";
    }

    const traduccion = await traducir(message, idiomaDestino);

    await db.collection("mensajes").add({
      idConversacion: userId,
      rol: "asistente",
      mensaje: message,
      original: traduccion,
      idiomaDetectado: idiomaDestino,
      tipo: "texto",
      timestamp: new Date().toISOString(),
      manual: true,
      agenteUid: agente.uid || null,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("❌ Error en /api/send-to-user:", error);
    res.status(500).json({ error: "Error enviando mensaje a usuario" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT} en 0.0.0.0`);
});
