import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

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
  if (/[\u3040-\u30ff]/.test(texto)) return "ja";
  if (/[\u4e00-\u9fa5]/.test(texto)) return "zh";
  if (/\b(the|you|and|hello|please|thank|how)\b/i.test(texto)) return "en";
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

// Subida de archivos
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  const userId = req.body.userId || "desconocido";
  await sendToSlack(`🖼️ Imagen subida por usuario [${userId}]: ${imageUrl}`);
  conversaciones.push({
    userId,
    lastInteraction: new Date().toISOString(),
    message: imageUrl,
    from: "usuario"
  });
  guardarConversaciones();
  res.json({ imageUrl });
});

// Chat
app.post("/api/chat", async (req, res) => {
  const { message, system, userId } = req.body;
  const finalUserId = userId || "anon";
  const idioma = detectarIdioma(message);
  const traducido = await traducir(message, "es");

  conversaciones.push({
    userId: finalUserId,
    lastInteraction: new Date().toISOString(),
    message: traducido,
    original: message,
    from: "usuario"
  });
  guardarConversaciones();

  if (shouldEscalateToHuman(message)) {
    await sendToSlack(`⚠️ [${finalUserId}] pide ayuda humana:\n${message}`, finalUserId);
    return res.json({ reply: "Voy a derivar tu solicitud a un agente humano. Por favor, espera mientras se realiza la transferencia." });
  }

  if (intervenidas[finalUserId]) {
    console.log(`⛔ GPT no responde a [${finalUserId}] porque ya ha intervenido un humano.`);
    return res.json({ reply: null });
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            (system || "Eres un asistente de soporte del canal digital funerario. Responde con claridad, precisión y empatía.") +
            ` Responde al usuario en el mismo idioma en que se ha escrito el mensaje.`,
        },
        { role: "user", content: traducido },
      ],
    });

    const reply = response.choices[0].message.content;
    const traduccionAlEspañol = idioma !== "es" ? await traducir(reply, "es") : reply;

    conversaciones.push({
      userId: finalUserId,
      lastInteraction: new Date().toISOString(),
      message: traduccionAlEspañol,
      original: reply,
      from: "asistente",
    });
    guardarConversaciones();
    await sendToSlack(`👤 [${finalUserId}] ${message}\n🤖 ${reply}`, finalUserId);
    res.json({ reply });
  } catch (err) {
    console.error("Error GPT:", err);
    res.status(500).json({ reply: "Lo siento, ha ocurrido un error al procesar tu mensaje." });
  }
});

// Panel: enviar respuesta
app.post("/api/send-to-user", express.json(), async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: "Faltan datos" });

  const ultimoMensajeUsuario = [...conversaciones]
    .reverse()
    .find(m => m.userId === userId && m.from === "usuario");

  const idiomaDestino = ultimoMensajeUsuario
    ? detectarIdioma(ultimoMensajeUsuario.original || ultimoMensajeUsuario.message)
    : "es";

  const traduccion = await traducir(message, idiomaDestino);

  conversaciones.push({
    userId,
    lastInteraction: new Date().toISOString(),
    message: traduccion,
    original: message,
    from: "asistente",
    manual: true,
  });

  intervenidas[userId] = true;
  guardarConversaciones();

  if (!slackResponses.has(userId)) slackResponses.set(userId, []);
  slackResponses.get(userId).push(traduccion);

  console.log(`📨 Mensaje enviado desde el panel a [${userId}] (${idiomaDestino}): ${traduccion}`);
  res.json({ ok: true });
});

// Marcar como visto
app.post("/api/marcar-visto", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Falta userId" });
  vistas[userId] = new Date().toISOString();
  guardarConversaciones();
  res.json({ ok: true });
});

// Historial y polling
app.get("/api/conversaciones", (req, res) => res.json(conversaciones));

app.get("/api/conversaciones/:userId", (req, res) => {
  const { userId } = req.params;
  const mensajes = conversaciones.filter(m => String(m.userId).toLowerCase() === String(userId).toLowerCase());
  res.json(mensajes);
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
