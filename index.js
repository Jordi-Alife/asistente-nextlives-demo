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

// Ruta para recibir respuestas desde Slack
app.post("/api/slack-response", express.json(), async (req, res) => {
  const { type, challenge, event } = req.body;
  if (type === "url_verification") return res.send({ challenge });

  if (event && event.type === "message" && !event.bot_id) {
    const text = event.text;
    const match = text.match(/\[(.*?)\]/);
    const userId = match?.[1];
    const message = text.replace(/\[.*?\]\s*/, "").trim();

    if (userId && message) {
      // Aquí puedes conectar con WebSocket o tu frontend para enviar al usuario en tiempo real
      console.log(`📩 Mensaje desde Slack para [${userId}]: ${message}`);
    }
  }

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
// Endpoint para eventos de Slack (verificación y mensajes)
app.post("/api/slack-response", express.json(), async (req, res) => {
  const { type, challenge, event } = req.body;

  // Verificación inicial del endpoint
  if (type === "url_verification") {
    return res.send({ challenge });
  }

  // Si es un mensaje nuevo en el canal de Slack
  if (type === "event_callback" && event?.type === "message" && !event?.bot_id) {
    const text = event.text;
    const channel = event.channel;

    // Buscamos el ID del usuario al que se quiere responder (si está incluido en el mensaje)
    const match = text.match(/\[ID:(.*?)\]/);
    const userId = match ? match[1] : null;

    if (userId) {
      // Aquí puedes guardar el mensaje en una cola, BBDD o memoria para enviarlo al frontend
      console.log(`➡️ Slack quiere enviar a usuario [${userId}]: ${text}`);
      // Lo ideal sería guardar esto temporalmente, por ejemplo con Redis, o usar websockets
    }

    return res.sendStatus(200);
  }

  res.sendStatus(200);
});
