import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

// ID persistente por usuario
function getUserId(req) {
  if (!req.headers["x-user-id"]) {
    req.headers["x-user-id"] = randomUUID(); // fallback por si no lo envía el frontend
  }
  return req.headers["x-user-id"];
}

// Configurar subida de archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    cb(null, filename);
  },
});
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Función para enviar mensaje a Slack
async function sendToSlack(message) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}

// Detección básica de intención de ayuda humana
function necesitaHumano(texto) {
  const frases = [
    "necesito hablar con una persona",
    "quiero hablar con un humano",
    "me puedes pasar con alguien",
    "esto no lo puede resolver un robot",
    "quiero ayuda de verdad",
    "quiero hablar con una persona",
    "puedo hablar con alguien",
    "quiero asistencia humana",
    "quiero hablar con alguien",
    "hablar con soporte humano"
  ];
  return frases.some(f => texto.toLowerCase().includes(f));
}

// Ruta para subir imágenes
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  const userId = getUserId(req);

  await sendToSlack(`📎 Imagen subida por usuario ${userId}: ${imageUrl}`);
  res.json({ imageUrl, reply: "Imagen recibida. La hemos enviado al equipo para ayudarte mejor." });
});

// Ruta principal del chat
app.post("/api/chat", async (req, res) => {
  const { message, system } = req.body;
  const userId = getUserId(req);

  // 🔔 Detectar si necesita ayuda humana
  if (necesitaHumano(message)) {
    await sendToSlack(`🚨 *Un usuario ha pedido ayuda humana*\n🆔 ID: ${userId}\n💬 Mensaje: ${message}`);
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

    await sendToSlack(
  `👤 Usuario (${userId}): ${message}\n🤖 Asistente: ${reply}\n\n[RESPONDER: ${userId}] — no borrar este ID`
);
    res.json({ reply });
  } catch (error) {
    console.error("Error GPT:", error);
    res.status(500).json({ reply: "Lo siento, ha ocurrido un error al procesar tu mensaje." });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
