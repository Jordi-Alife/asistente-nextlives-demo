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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// Generar ID único por sesión
app.use((req, res, next) => {
  if (!req.headers["x-user-id"]) {
    req.headers["x-user-id"] = uuidv4();
  }
  next();
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

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Enviar texto a Slack
async function sendToSlack(message) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}

// Endpoint para subir imagen
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  const userId = req.headers["x-user-id"];

  await sendToSlack(`🖼️ Imagen recibida de usuario *${userId}*: ${imageUrl}`);
  res.json({ imageUrl, reply: "Gracias, hemos recibido tu imagen. Enseguida reviso la información." });
});

// Endpoint de chat
app.post("/api/chat", async (req, res) => {
  const { message, system } = req.body;
  const userId = req.headers["x-user-id"] || "desconocido";

  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: system || "Eres un asistente de soporte del canal digital funerario. Responde con claridad, precisión y empatía.",
        },
        { role: "user", content: message },
      ],
    });

    const reply = chatResponse.choices[0].message.content;

    // Enviar mensaje a Slack
    await sendToSlack(`👤 Usuario *${userId}*:\n${message}\n🤖 Asistente:\n${reply}`);

    // Detectar si GPT no puede ayudar bien
    const lowerReply = reply.toLowerCase();
    const triggerPhrases = [
      "no tengo esa información",
      "debes contactar con la funeraria",
      "no puedo ayudarte con eso",
      "no tengo acceso",
      "no estoy seguro",
      "no dispongo de esa información",
      "te recomiendo que consultes",
      "no tengo información precisa",
      "lamentablemente no puedo ayudarte con eso",
      "no tengo datos sobre eso",
      "lamento no poder proporcionarte esa información",
      "mi función principal es asistirte en asuntos relacionados a servicios funerarios",
      "lamentablemente no tengo acceso a esa información",
      "deberás contactar con el centro funerario",
      "no tengo la capacidad de ayudarte con eso",
      "hay muchas aplicaciones y sitios web donde puedes consultar"
    ];

    const needsHuman = triggerPhrases.some(phrase => lowerReply.includes(phrase));
    if (needsHuman) {
      await sendToSlack(`🚨 *Derivar a humano* para el usuario *${userId}*. La IA no pudo resolver su consulta correctamente.`);
    }

    res.json({ reply });
  } catch (error) {
    console.error("Error GPT:", error);
    res.status(500).json({ reply: "Lo siento, ha ocurrido un error al procesar tu mensaje." });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
