// index.js
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
let intervenidas = {}; // NUEVO

if (fs.existsSync(HISTORIAL_PATH)) {
  const data = JSON.parse(fs.readFileSync(HISTORIAL_PATH, "utf8"));
  if (Array.isArray(data)) {
    conversaciones = data;
  } else {
    conversaciones = data.conversaciones || [];
    vistas = data.vistas || {};
    intervenidas = data.intervenidas || {};
  }
}

function guardarConversaciones() {
  fs.writeFileSync(
    HISTORIAL_PATH,
    JSON.stringify({ conversaciones, vistas, intervenidas }, null, 2)
  );
}

const slackResponses = new Map();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, filename);
  },
});
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function sendToSlack(message, userId = null) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  const text = userId ? `[${userId}] ${message}` : message;

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
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
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  const userId = req.body.userId || "desconocido";
  await sendToSlack(`🖼️ Imagen subida por usuario [${userId}]: ${imageUrl}`);
  res.json({ imageUrl });
});

app.post("/api/chat", async (req, res) => {
  const { message, system, userId } = req.body;
  const finalUserId = userId || "anon";

  conversaciones.push({
    userId: finalUserId,
    lastInteraction: new Date().toISOString(),
    message,
    from: "usuario"
  });
  guardarConversaciones();

  if (shouldEscalateToHuman(message)) {
    const alertMessage = `⚠️ Usuario [${finalUserId}] ha solicitado ayuda de un humano:\n${message}`;
    await sendToSlack(alertMessage, finalUserId);
    return res.json({ reply: "Voy a derivar tu solicitud a un agente humano. Por favor, espera mientras se realiza la transferencia." });
  }

  if (intervenidas[finalUserId]) {
    console.log(`⛔ GPT no responde a [${finalUserId}] porque ya ha intervenido un humano.`);
    return res.json({ reply: null });
  }

  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: system || "Eres un asistente de soporte del canal digital funerario. Responde con claridad, precisión y empatía."
        },
        { role: "user", content: message }
      ]
    });

    const reply = chatResponse.choices[0].message.content;

    conversaciones.push({
      userId: finalUserId,
      lastInteraction: new Date().toISOString(),
      message: reply,
      from: "asistente"
    });
    guardarConversaciones();

    await sendToSlack(`👤 [${finalUserId}] ${message}\n🤖 ${reply}`, finalUserId);
    res.json({ reply });
  } catch (error) {
    console.error("Error GPT:", error);
    res.status(500).json({ reply: "Lo siento, ha ocurrido un error al procesar tu mensaje." });
  }
});

app.post("/api/send-to-user", express.json(), async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ error: "Faltan userId o message" });
  }

  conversaciones.push({
    userId,
    message,
    lastInteraction: new Date().toISOString(),
    from: "asistente",
    manual: true // NUEVO: marca que fue enviado por humano
  });

  intervenidas[userId] = true;
  guardarConversaciones();

  if (!slackResponses.has(userId)) slackResponses.set(userId, []);
  slackResponses.get(userId).push(message);

  console.log(`📨 Mensaje enviado desde el panel a [${userId}]`);
  res.json({ ok: true });
});

app.post("/api/marcar-visto", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Falta userId" });

  vistas[userId] = new Date().toISOString();
  guardarConversaciones();

  console.log(`✅ Conversación vista marcada para [${userId}]`);
  res.json({ ok: true });
});

app.get("/api/conversaciones", (req, res) => {
  res.json(conversaciones);
});

app.get("/api/conversaciones/:userId", (req, res) => {
  const { userId } = req.params;
  const mensajes = conversaciones.filter(m =>
    String(m.userId).trim().toLowerCase() === String(userId).trim().toLowerCase()
  );
  res.json(mensajes);
});

app.get("/api/vistas", (req, res) => {
  res.json(vistas);
});

app.get("/api/poll/:userId", (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: "Falta userId" });
  }

  const mensajes = slackResponses.get(userId) || [];
  slackResponses.set(userId, []);

  res.json({ mensajes });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
