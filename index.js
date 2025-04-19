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

const conversaciones = []; // Historial completo
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

// Subida de archivos
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  const userId = req.body.userId || "desconocido";
  await sendToSlack(`🖼️ Imagen subida por usuario [${userId}]: ${imageUrl}`);
  res.json({ imageUrl });
});

// Usuario escribe
app.post("/api/chat", async (req, res) => {
  const { message, system, userId } = req.body;
  const finalUserId = userId || "anon";

  conversaciones.push({
    userId: finalUserId,
    lastInteraction: new Date().toISOString(),
    message,
    sender: "user"
  });

  if (shouldEscalateToHuman(message)) {
    const alertMessage = `⚠️ Usuario [${finalUserId}] ha solicitado ayuda de un humano:\n${message}`;
    await sendToSlack(alertMessage, finalUserId);
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

    conversaciones.push({
      userId: finalUserId,
      lastInteraction: new Date().toISOString(),
      message: reply,
      sender: "assistant"
    });

    await sendToSlack(`👤 [${finalUserId}] ${message}\n🤖 ${reply}`, finalUserId);
    res.json({ reply });
  } catch (error) {
    console.error("Error GPT:", error);
    res.status(500).json({ reply: "Lo siento, ha ocurrido un error al procesar tu mensaje." });
  }
});

// Slack responde
app.post("/api/slack-response", express.json(), async (req, res) => {
  const { type, challenge, event } = req.body;

  if (type === "url_verification") return res.send({ challenge });

  if (type === "event_callback" && event?.type === "message" && !event?.bot_id) {
    const text = event.text || "";
    const match = text.match(/\[(.*?)\]/);
    const userId = match?.[1];
    const message = text.replace(/\[.*?\]\s*/, "").trim();

    if (userId && message) {
      conversaciones.push({
        userId,
        lastInteraction: new Date().toISOString(),
        message,
        sender: "human"
      });

      if (!slackResponses.has(userId)) {
        slackResponses.set(userId, []);
      }
      slackResponses.get(userId).push(message);
    }
  }

  res.sendStatus(200);
});

// Polling desde frontend
app.get("/api/poll/:id", (req, res) => {
  const userId = req.params.id;
  const mensajes = slackResponses.get(userId) || [];
  slackResponses.set(userId, []);
  res.json({ mensajes });
});

// Obtener conversaciones (último mensaje por usuario)
app.get("/api/conversaciones", (req, res) => {
  const ultimaPorUsuario = {};

  for (let i = conversaciones.length - 1; i >= 0; i--) {
    const conv = conversaciones[i];
    if (!ultimaPorUsuario[conv.userId]) {
      ultimaPorUsuario[conv.userId] = conv;
    }
  }

  const resultado = Object.values(ultimaPorUsuario).sort(
    (a, b) => new Date(b.lastInteraction) - new Date(a.lastInteraction)
  );

  res.json(resultado);
});

// Enviar mensaje desde el panel
app.post("/api/send-to-user", express.json(), async (req, res) => {
  const { userId, message } = req.body;

  if (!userId || !message) {
    return res.status(400).json({ error: "Faltan userId o message" });
  }

  conversaciones.push({
    userId,
    lastInteraction: new Date().toISOString(),
    message,
    sender: "admin"
  });

  if (!slackResponses.has(userId)) {
    slackResponses.set(userId, []);
  }

  slackResponses.get(userId).push(message);
  res.json({ ok: true });
});

// Obtener todos los mensajes de un usuario
app.get("/api/conversaciones/:userId", (req, res) => {
  const { userId } = req.params;
  const mensajes = conversaciones.filter(m => m.userId === userId);
  res.json(mensajes);
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
