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
const slackResponses = new Map(); // 🔹 Respuestas para el chat

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

// Subida de archivos
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  const userId = getOrCreateUserId(req.ip);
  await sendToSlack(`🖼️ Imagen subida por usuario [${userId}]: ${imageUrl}`);
  res.json({ imageUrl });
});

// Mensaje principal del chat
app.post("/api/chat", async (req, res) => {
  const { message, system } = req.body;
  const userId = getOrCreateUserId(req.ip);

  if (shouldEscalateToHuman(message)) {
    const alertMessage = `⚠️ Usuario [${userId}] ha solicitado ayuda de un humano:\n${message}`;
    await sendToSlack(alertMessage, userId);
    return res.json({ reply: "Voy a derivar tu solicitud a un agente humano. Por favor, espera mientras se realiza la transferencia." });
  }

  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: system || "Eres un asistente de soporte del canal digital funerario. Responde con claridad, precisión y empatía. Si no puedes ayudar, indica que derivarás a un humano."
        },
        { role: "user", content: message }
      ]
    });

    const reply = chatResponse.choices[0].message.content;
    await sendToSlack(`👤 [${userId}] ${message}\n🤖 ${reply}`, userId);
    res.json({ reply });
  } catch (error) {
    console.error("Error GPT:", error);
    res.status(500).json({ reply: "Lo siento, ha ocurrido un error al procesar tu mensaje." });
  }
});

// ✅ Endpoint para mensajes desde Slack
app.post("/api/slack-response", express.json(), async (req, res) => {
  console.log("📥 Evento recibido de Slack:", JSON.stringify(req.body, null, 2));
  await sendToSlack("📩 Payload recibido en backend");

  const { type, challenge, event } = req.body;

  if (type === "url_verification") return res.send({ challenge });

  if (event) {
    const text = event.text || "";
    const match = text.match(/\[(.*?)\]/); // Buscar [id] al inicio
    const userId = match?.[1];
    const message = text.replace(/\[.*?\]\s*/, "").trim();

    if (userId && message) {
      if (!slackResponses.has(userId)) {
        slackResponses.set(userId, []);
      }
      slackResponses.get(userId).push(message);
      console.log(`💬 Slack respondió a [${userId}]: ${message}`);
    }
  }

  res.sendStatus(200);
});

// Endpoint para frontend que recupera mensajes desde Slack
app.get("/api/poll/:id", (req, res) => {
  const userId = req.params.id;
  const mensajes = slackResponses.get(userId) || [];
  slackResponses.set(userId, []); // vaciar tras enviar
  res.json({ mensajes });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
