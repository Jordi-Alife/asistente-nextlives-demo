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
const userIds = new Map();
const mensajesPendientes = {};

function getOrCreateUserId(ip) {
  if (!userIds.has(ip)) {
    userIds.set(ip, uuidv4().slice(0, 8));
  }
  return userIds.get(ip);
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

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  const userId = getOrCreateUserId(req.ip);
  await sendToSlack(`🖼️ Imagen subida por usuario [${userId}]: ${imageUrl}`);
  res.json({ imageUrl });
});

app.post("/api/chat", async (req, res) => {
  const { message, system } = req.body;
  const userId = getOrCreateUserId(req.ip);

  const messages = [
    {
      role: "system",
      content:
        system || "Eres un asistente de soporte del canal digital funerario. Responde con claridad, precisión y empatía. Si no puedes ayudar, indica que derivarás a un humano.",
    },
    { role: "user", content: message },
  ];

  const lowerText = message.toLowerCase();
  const quiereHumano =
    lowerText.includes("hablar con una persona") ||
    lowerText.includes("ayuda de un humano") ||
    lowerText.includes("quiero un humano") ||
    lowerText.includes("pasame con un humano");

  if (quiereHumano) {
    await sendToSlack(`⚠️ Usuario [${userId}] ha solicitado ayuda de un humano:\n> ${message}`);
    return res.json({
      reply: "Voy a derivar tu solicitud a un asistente humano que podrá ayudarte mejor. Por favor, espera unos momentos.",
    });
  }

  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
    });

    const reply = chatResponse.choices[0].message.content;
    await sendToSlack(`👤 [${userId}] ${message}\n🤖 ${reply}`, userId);
    res.json({ reply });
  } catch (error) {
    console.error("Error GPT:", error);
    res.status(500).json({ reply: "Lo siento, ha ocurrido un error al procesar tu mensaje." });
  }
});

app.post("/api/slack-response", express.json(), async (req, res) => {
  const { type, challenge, event } = req.body;

  if (type === "url_verification") return res.send({ challenge });

  if (type === "event_callback" && event?.type === "message" && !event?.bot_id) {
    const text = event.text;
    const match = text.match(/\[(.*?)\]/);
    const userId = match?.[1];
    const message = text.replace(/\[.*?\]\s*/, "").trim();

    if (userId && message) {
      if (!mensajesPendientes[userId]) {
        mensajesPendientes[userId] = [];
      }
      mensajesPendientes[userId].push(message);
      console.log(`✅ Slack envió mensaje para [${userId}]: ${message}`);
    }
  }

  res.sendStatus(200);
});

app.get("/api/poll/:id", (req, res) => {
  const userId = req.params.id;
  const mensajes = mensajesPendientes[userId] || [];
  mensajesPendientes[userId] = [];
  res.json({ mensajes });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
