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

// Configuración de subida de archivos
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

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Identificador por usuario
const userIds = new Map();
function getOrCreateUserId(ip) {
  if (!userIds.has(ip)) userIds.set(ip, uuidv4().slice(0, 8));
  return userIds.get(ip);
}

// Enviar mensaje a Slack
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

// Subida de archivos
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  const userId = getOrCreateUserId(req.ip);
  await sendToSlack(`🖼️ Imagen subida por usuario [${userId}]: ${imageUrl}`);
  res.json({ imageUrl });
});

// Chat principal
app.post("/api/chat", async (req, res) => {
  const { message, system } = req.body;
  const userId = getOrCreateUserId(req.ip);

  const lower = message.toLowerCase();
  const necesitaHumano = lower.includes("humano") || lower.includes("persona") || lower.includes("hablar con alguien");

  if (necesitaHumano) {
    const alerta = `⚠️ Usuario [${userId}] ha solicitado ayuda de un humano:\n> ${message}`;
    await sendToSlack(alerta, userId);
    return res.json({
      reply: "Voy a derivar tu solicitud a un asistente humano que podrá ayudarte mejor. Por favor, espera unos momentos."
    });
  }

  const messages = [
    {
      role: "system",
      content: system || "Eres un asistente de soporte del canal digital funerario. Responde con claridad, precisión y empatía. Si no puedes ayudar, indica que derivarás a un humano."
    },
    { role: "user", content: message }
  ];

  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages
    });

    const reply = chatResponse.choices[0].message.content;
    await sendToSlack(`👤 [${userId}] ${message}\n🤖 ${reply}`, userId);
    res.json({ reply });
  } catch (error) {
    console.error("Error GPT:", error);
    res.status(500).json({ reply: "Lo siento, ha ocurrido un error al procesar tu mensaje." });
  }
});

// Endpoint para recibir mensajes desde Slack (respuesta humana)
app.post("/api/slack-response", express.json(), async (req, res) => {
  const { type, challenge, event } = req.body;

  if (type === "url_verification") {
    return res.send({ challenge });
  }

  if (type === "event_callback" && event?.type === "message" && !event?.bot_id) {
    const text = event.text;
    const match = text.match(/\[ID:(.*?)\]/);
    const userId = match ? match[1] : null;

    if (userId) {
      console.log(`➡️ Slack quiere enviar a usuario [${userId}]: ${text}`);
      // Aquí podrías almacenar esto y enviarlo al frontend vía WebSocket o cola
    }
    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
