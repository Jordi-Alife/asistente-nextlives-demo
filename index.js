import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch"; // <- necesario para enviar a Slack

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Función para enviar a Slack
async function sendToSlack(message) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;

  const payload = {
    text: message,
  };

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("Error al enviar a Slack:", err);
  }
}

// Ruta principal del chat
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;

  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "Eres el asistente de soporte del canal digital de homenaje de NextLives. Responde siempre de forma específica sobre el funcionamiento de la web, sus contenidos, permisos y servicios, en base a la información proporcionada por la empresa funeraria.",
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    const reply = chatResponse.choices[0].message.content;

    // Enviar a Slack
    await sendToSlack(`👤 Usuario: ${message}\n🤖 Asistente: ${reply}`);

    res.json({ reply });
  } catch (error) {
    console.error("Error GPT:", error);
    res.status(500).json({
      reply: "Lo siento, ha ocurrido un error al procesar tu mensaje.",
    });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
