import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { createServer } from "http";
import { WebSocketServer } from "ws";

const app = express();
const server = createServer(app); // servidor HTTP necesario para WebSocket
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Almacena conexiones activas: { [userId]: ws }
const connections = {};

wss.on("connection", (ws, req) => {
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.userId) {
        connections[msg.userId] = ws;
        console.log(`🟢 WebSocket conectado para usuario [${msg.userId}]`);
      }
    } catch (err) {
      console.error("Error WebSocket:", err);
    }
  });

  ws.on("close", () => {
    for (const id in connections) {
      if (connections[id] === ws) {
        delete connections[id];
        console.log(`🔴 WebSocket desconectado para usuario [${id}]`);
      }
    }
  });
});

// Configuración de subida de imágenes
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
const upload = multer({ storage });

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
  await sendToSlack(`🖼️ Imagen subida por usuario [${userId}]: ${imageUrl}`, userId);
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

// Recepción de mensajes desde Slack
app.post("/api/slack-response", express.json(), async (req, res) => {
  const { type, challenge, event } = req.body;

  if (type === "url_verification") return res.send({ challenge });

  if (event && event.type === "message" && !event.bot_id) {
    const text = event.text;
    const match = text.match(/\[(.*?)\]/);
    const userId = match?.[1];
    const message = text.replace(/\[.*?\]\s*/, "").trim();

    if (userId && message) {
      console.log(`📩 Slack -> Usuario [${userId}]: ${message}`);
      const ws = connections[userId];
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ sender: "assistant", text: message }));
      }
    }
  }

  res.sendStatus(200);
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
