import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";
import multer from "multer";
import path from "path";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// Subida de imágenes
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
app.use("/uploads", express.static("uploads")); // acceso a imágenes

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Enviar alerta a Slack
async function sendToSlack(message) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}

// Subida de imágenes
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;

  await sendToSlack(`🖼️ Imagen subida por usuario: ${imageUrl}`);
  res.json({ imageUrl });
});

// Chat principal
app.post("/api/chat", async (req, res) => {
  const { message, system, userId } = req.body;

  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: system || "Eres un asistente de soporte del canal digital funerario. Responde con claridad, precisión y empatía.",
        },
        { role: "user", content: message }
      ]
    });

    const reply = chatResponse.choices[0].message.content;

    // Enviar conversación normal a Slack
    await sendToSlack(`👤 Usuario ID: ${userId || "desconocido"}
❓ Pregunta: ${message}
🤖 Respuesta: ${reply}`);

    // Detección de respuestas que requieren atención humana
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
      "no tengo datos sobre eso"
    ];

    const lowerReply = reply.toLowerCase();
    const needsHuman = triggerPhrases.some(phrase => lowerReply.includes(phrase));

    if (needsHuman) {
      await sendToSlack(`🚨 Posible intervención humana necesaria:
👤 Usuario ID: ${userId || "desconocido"}
❓ Pregunta: ${message}
🤖 Respuesta: ${reply}`);
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
