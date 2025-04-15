import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Función para enviar mensajes a Slack
async function sendToSlack(message) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message })
    });
  } catch (err) {
    console.error("Error al enviar a Slack:", err);
  }
}

// Ruta del chat
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;

  try {
    // Leer el archivo de base de conocimiento
    const filePath = path.join(process.cwd(), "base_conocimiento_actualizado.txt");
    const conocimiento = fs.readFileSync(filePath, "utf-8");

    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `
Eres un asistente virtual de soporte del canal digital de NextLives, integrado en la web conmemorativa de la funeraria.

Tu tono es cercano, amigable y respetuoso.

Usa exclusivamente la siguiente base de conocimiento para responder de forma clara y específica. Si no encuentras la respuesta, sugiere contactar con la funeraria correspondiente.

BASE DE CONOCIMIENTO:
${conocimiento}
          `.trim()
        },
        {
          role: "user",
          content: message
        }
      ]
    });

    const reply = chatResponse.choices[0].message.content;
    await sendToSlack(`👤 Usuario: ${message}\n🤖 Asistente: ${reply}`);
    res.json({ reply });

  } catch (error) {
    console.error("Error GPT:", error);
    res.status(500).json({
      reply: "Lo siento, ha ocurrido un error al procesar tu mensaje.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
