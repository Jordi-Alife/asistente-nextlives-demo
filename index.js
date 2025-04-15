import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { Configuration, OpenAIApi } from "openai";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Configurar OpenAI
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Ruta para recibir mensajes
app.post("/api/chat", async (req, res) => {
  const { mensaje } = req.body;

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "Eres un asistente amable que responde de forma breve y clara.",
        },
        {
          role: "user",
          content: mensaje,
        },
      ],
    });

    const respuesta = completion.data.choices[0].message.content;
    res.json({ response: respuesta });
  } catch (error) {
    console.error("Error al conectar con OpenAI:", error.message);
    res.status(500).json({ response: "Error al generar respuesta desde OpenAI." });
  }
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
