import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const conversaciones = [];

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

const slackResponses = new Map();

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

// ð¤ Subida de archivos
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subiÃ³ ninguna imagen" });
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  const userId = req.body.userId || "desconocido";
  await sendToSlack(`ð¼ï¸ Imagen subida por usuario [${userId}]: ${imageUrl}`);
  res.json({ imageUrl });
});

// ð¬ Mensaje principal del chat

app.post("/api/chat", async (req, res) => {
  const { message, system, userId } = req.body;
  const finalUserId = userId || "anon";

  // Guardar mensaje para el panel
  const entrada = {
    userId: finalUserId,
    lastInteraction: new Date().toISOString(),
    message
  };
  conversaciones.push(entrada);

  if (shouldEscalateToHuman(message)) {
    const alertMessage = `â ï¸ Usuario [${finalUserId}] ha solicitado ayuda de un humano:\n${message}`;
    await sendToSlack(alertMessage, finalUserId);
    return res.json({ reply: "Voy a derivar tu solicitud a un agente humano. Por favor, espera mientras se realiza la transferencia." });
  }

  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: system || "Eres un asistente de soporte del canal digital funerario. Responde con claridad, precisiÃ³n y empatÃ­a. Si no puedes ayudar, indica que derivarÃ¡s a un humano."
        },
        { role: "user", content: message }
      ]
    });

    const reply = chatResponse.choices[0].message.content;
    await sendToSlack(`ð¤ [${finalUserId}] ${message}\nð¤ ${reply}`, finalUserId);
    res.json({ reply });
  } catch (error) {
    console.error("Error GPT:", error);
    res.status(500).json({ reply: "Lo siento, ha ocurrido un error al procesar tu mensaje." });
  }
});
  const { message, system, userId } = req.body;
  const finalUserId = userId || "anon";

  if (shouldEscalateToHuman(message)) {
    const alertMessage = `â ï¸ Usuario [${finalUserId}] ha solicitado ayuda de un humano:\n${message}`;
    await sendToSlack(alertMessage, finalUserId);
    return res.json({ reply: "Voy a derivar tu solicitud a un agente humano. Por favor, espera mientras se realiza la transferencia." });
  }

  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: system || "Eres un asistente de soporte del canal digital funerario. Responde con claridad, precisiÃ³n y empatÃ­a. Si no puedes ayudar, indica que derivarÃ¡s a un humano."
        },
        { role: "user", content: message }
      ]
    });

    const reply = chatResponse.choices[0].message.content;
    await sendToSlack(`ð¤ [${finalUserId}] ${message}\nð¤ ${reply}`, finalUserId);
    res.json({ reply });
  } catch (error) {
    console.error("Error GPT:", error);
    res.status(500).json({ reply: "Lo siento, ha ocurrido un error al procesar tu mensaje." });
  }
});

// ð¥ Mensajes desde Slack
app.post("/api/slack-response", express.json(), async (req, res) => {
  console.log("ð¥ Evento recibido de Slack:", JSON.stringify(req.body, null, 2));
  const { type, challenge, event } = req.body;

  if (type === "url_verification") return res.send({ challenge });

  if (type === "event_callback" && event?.type === "message" && !event?.bot_id) {
    const text = event.text || "";
    const match = text.match(/\[(.*?)\]/);
    const userId = match?.[1];
    const message = text.replace(/\[.*?\]\s*/, "").trim();

    console.log("ð¡ Evento procesado:", { userId, message });

    if (userId && message) {
      if (!slackResponses.has(userId)) {
        slackResponses.set(userId, []);
      }
      slackResponses.get(userId).push(message);
      console.log(`ð¬ Slack respondiÃ³ a [${userId}]: ${message}`);
    }
  }

  res.sendStatus(200);
});

// ð Polling desde frontend
app.get("/api/poll/:id", (req, res) => {
  const userId = req.params.id;
  const mensajes = slackResponses.get(userId) || [];
  slackResponses.set(userId, []); // Vaciar despuÃ©s
  console.log("ð¤ Enviando mensajes al frontend:", { userId, mensajes });
  res.json({ mensajes });
});


// Nueva ruta para leer conversaciones desde el panel
app.get("/api/conversaciones", (req, res) => {
  res.json(conversaciones);
});
app.listen(PORT, () => {
  console.log(`ð Servidor escuchando en puerto ${PORT}`);
});
