// index.js (continuación del archivo anterior)
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

async function traducir(texto, idiomaDestino = "es") {
  const respuesta = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: `Traduce el siguiente texto al idioma ${idiomaDestino}. Solo responde con el texto traducido, sin añadir comentarios.`,
      },
      {
        role: "user",
        content: texto,
      },
    ],
  });

  return respuesta.choices[0].message.content.trim();
}

function detectarIdiomaUsuario(userId) {
  const primerMensaje = conversaciones.find(
    (m) => m.userId === userId && m.from === "usuario"
  );
  if (!primerMensaje) return "es";
  const texto = primerMensaje.original || primerMensaje.message || "";
  if (/[\u4E00-\u9FFF]/.test(texto)) return "zh"; // ejemplo para chino
  if (/^[a-zA-Z0-9\s.,;!?'"()-]+$/.test(texto)) return "en"; // muy básico
  return "es"; // fallback
}

app.post("/api/send-to-user", express.json(), async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ error: "Faltan userId o message" });
  }

  const idiomaUsuario = detectarIdiomaUsuario(userId);
  const mensajeTraducido = idiomaUsuario === "es" ? message : await traducir(message, idiomaUsuario);

  conversaciones.push({
    userId,
    message: mensajeTraducido,
    original: message,
    lastInteraction: new Date().toISOString(),
    from: "asistente",
    manual: true,
  });

  intervenidas[userId] = true;
  guardarConversaciones();

  if (!slackResponses.has(userId)) slackResponses.set(userId, []);
  slackResponses.get(userId).push(mensajeTraducido);

  console.log(`📨 Mensaje enviado desde el panel a [${userId}]`);
  res.json({ ok: true });
});
