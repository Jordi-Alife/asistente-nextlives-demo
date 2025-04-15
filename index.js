import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // Servir archivos estáticos

// Ruta de la IA
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;

  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Eres un asistente virtual llamado "Asistente IA Canal Digital". Estás integrado dentro de la web de homenaje de una funeraria y tu función es ayudar a los visitantes a resolver dudas sobre el canal digital.

Responde siempre con información específica de NextLives y del canal digital, según el siguiente contexto:

- El canal digital es una web de homenaje personalizada con los datos del funeral, fotos, videos y mensajes.
- Los visitantes pueden enviar mensajes de texto, dibujo o audio.
- Registrándose, pueden acceder a una zona privada familiar para publicar fotos, vídeos y citas.
- Para usar la zona familiar deben recibir permiso de un administrador o superadministrador.
- También se puede comprar flores desde la web.
- El canal digital puede verse en Smart TV, tiene opciones multilingües y cuenta con asistencia.
- No menciones NextLives directamente en la respuesta si no lo hace el usuario; responde como si fueses parte del servicio de la funeraria.

Sé siempre claro, conciso y útil. No des definiciones genéricas.`
        },
        {
          role: "user",
          content: message
        }
      ]
    });

    const reply = chatResponse.choices[0].message.content;
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
