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

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configurar subida de imágenes
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

// Detectar intención de ayuda humana
function needsHuman(text) {
  const patterns = [
    /necesito hablar con (una )?persona/i,
    /quiero hablar con (alguien|un humano|una persona)/i,
    /puedo contactar con/i,
    /quiero atención (humana|personalizada)/i,
    /quiero ayuda real/i
  ];
  return patterns.some((regex) => regex.test(text));
}

// Slack: Enviar mensaje
async function sendToSlack(text, userId) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `🧾 Usuario ${userId}:\n${text}` }),
  });
}

// Generar o recuperar ID por usuario
function getUserId(req) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const idFile = "./user-ids.json";

  let userIds = {};
  if (fs.existsSync(idFile)) {
    userIds = JSON.parse(fs.readFileSync(idFile));
  }

  if (!userIds[ip]) {
    userIds[ip] = randomUUID();
    fs.writeFileSync(idFile, JSON.stringify(userIds));
  }

  return userIds[ip];
}

// Endpoint: subida de imagen
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });
  const url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  const userId = getUserId(req);

  await sendToSlack(`📷 Imagen recibida: ${url}`, userId);
  res.json({ reply: "Imagen enviada correctamente." });
});

// Endpoint: conversación
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;
  const userId = getUserId(req);

  if (needsHuman(message)) {
    const aviso = `⚠️ El usuario ${userId} ha solicitado ayuda humana:\n"${message}"`;
    await sendToSlack(aviso, userId);
    return res.json({
      reply: "He solicitado a un miembro del equipo que se ponga en contacto contigo lo antes posible. Mientras tanto, ¿hay algo más en lo que pueda ayudarte?"
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "Eres un asistente del canal digital funerario. Responde con claridad, precisión y empatía. Usa siempre un lenguaje respetuoso.",
        },
        { role: "user", content: message }
      ],
    });

    const reply = completion.choices[0].message.content;
    await sendToSlack(`👤 ${message}\n🤖 ${reply}`, userId);
    res.json({ reply });
  } catch (err) {
    console.error("Error GPT:", err);
    res.status(500).json({ reply: "Lo siento, ha ocurrido un error procesando tu mensaje." });
  }
});

// Slack Event Verification
app.post("/api/slack-response", async (req, res) => {
  const { type, challenge, event } = req.body;
  if (type === "url_verification") return res.status(200).send(challenge);
  console.log("Slack Event:", event);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
