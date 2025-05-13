import express from "express";
import cors from "cors";
import OpenAI from "openai";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import admin from "firebase-admin";
import serviceAccount from "./serviceAccountKey.json" assert { type: "json" };
import sharp from "sharp";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const app = express();
const PORT = process.env.PORT || 3000;
const HISTORIAL_PATH = "./historial.json";

let conversaciones = [];
let intervenidas = {};
let vistasPorAgente = {};
let escribiendoUsuarios = {};

if (fs.existsSync(HISTORIAL_PATH)) {
  const data = JSON.parse(fs.readFileSync(HISTORIAL_PATH, "utf8"));
  conversaciones = data.conversaciones || [];
  intervenidas = data.intervenidas || {};
  vistasPorAgente = data.vistasPorAgente || {};
}

function guardarConversaciones() {
  fs.writeFileSync(
    HISTORIAL_PATH,
    JSON.stringify({ conversaciones, intervenidas, vistasPorAgente }, null, 2)
  );
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function traducir(texto, target = "es") {
  const res = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: `Traduce el siguiente texto al idioma "${target}" sin explicar nada, solo la traducción.`,
      },
      { role: "user", content: texto },
    ],
  });
  return res.choices[0].message.content.trim();
}

async function detectarIdiomaGPT(texto) {
  const res = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: `Detecta el idioma exacto del siguiente texto. Devuelve solo el código ISO 639-1 de dos letras, sin explicación ni texto adicional.`,
      },
      { role: "user", content: texto },
    ],
  });
  return res.choices[0].message.content.trim().toLowerCase();
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

// NUEVO ENDPOINT PARA TRADUCIR TEXTO AL ÚLTIMO IDIOMA DETECTADO
app.post("/api/traducir-modal", async (req, res) => {
  const { userId, textos } = req.body;
  if (!userId || !Array.isArray(textos)) return res.status(400).json({ error: "Faltan datos" });

  try {
    const userDoc = await db.collection("usuarios_chat").doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    const idioma = userData?.idioma || "es";

    const traducciones = [];
    for (const texto of textos) {
      const traducido = await traducir(texto, idioma);
      traducciones.push(traducido);
    }

    res.json({ traducciones });
  } catch (error) {
    console.error("❌ Error en /api/traducir-modal:", error);
    res.status(500).json({ error: "Error traduciendo modal" });
  }
});
app.post("/api/chat", async (req, res) => {
  const { message, system, userId, userAgent, pais, historial, datosContexto } = req.body;
  const finalUserId = userId || "anon";
  const idioma = await detectarIdiomaGPT(message);

  try {
    // Guardar info usuario
    await db.collection("usuarios_chat").doc(finalUserId).set(
      {
        nombre: "Invitado",
        idioma: idioma,
        ultimaConexion: new Date().toISOString(),
        navegador: userAgent || "",
        pais: pais || "",
        historial: historial || [],
      },
      { merge: true }
    );

    // Guardar info conversación
    await db.collection("conversaciones").doc(finalUserId).set(
      {
        idUsuario: finalUserId,
        fechaInicio: new Date().toISOString(),
        estado: "abierta",
        idioma: idioma,
        navegador: userAgent || "",
        pais: pais || "",
        historial: historial || [],
        datosContexto: datosContexto || null,
      },
      { merge: true }
    );

    // Traducir y guardar mensaje usuario
    const traduccionUsuario = await traducir(message, "es");

    await db.collection("mensajes").add({
      idConversacion: finalUserId,
      rol: "usuario",
      mensaje: traduccionUsuario,
      original: message,
      idiomaDetectado: idioma,
      tipo: "texto",
      timestamp: new Date().toISOString(),
    });

    // ✅ Chequeo: si la conversación está intervenida, bloquear GPT
    const convDoc = await db.collection("conversaciones").doc(finalUserId).get();
    const convData = convDoc.exists ? convDoc.data() : null;

    if (convData?.intervenida) {
      console.log(`🤖 GPT desactivado: conversación intervenida para ${finalUserId}`);
      return res.json({ reply: "" });
    }

    if (shouldEscalateToHuman(message)) {
      return res.json({
        reply: "Voy a derivar tu solicitud a un agente humano. Por favor, espera mientras se realiza la transferencia.",
      });
    }

    // Preparar prompt y llamar a GPT
    const baseConocimiento = fs.existsSync("./base_conocimiento_actualizado.txt")
      ? fs.readFileSync("./base_conocimiento_actualizado.txt", "utf8")
      : "";

    const promptSystem = [
      baseConocimiento,
      datosContexto ? `\nInformación adicional de contexto JSON:\n${JSON.stringify(datosContexto)}` : "",
      `IMPORTANTE: Responde siempre en el idioma detectado del usuario: "${idioma}". Si el usuario escribió en catalán, responde en catalán; si lo hizo en inglés, responde en inglés; si en español, responde en español. No traduzcas ni expliques nada adicional.`,
    ].join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: promptSystem || `Eres un asistente de soporte funerario. Responde en el mismo idioma que el usuario.` },
        { role: "user", content: message },
      ],
    });

    const reply = response.choices[0].message.content;
    const traduccionRespuesta = await traducir(reply, "es");

    // Guardar respuesta GPT
    await db.collection("mensajes").add({
      idConversacion: finalUserId,
      rol: "asistente",
      mensaje: traduccionRespuesta,
      original: reply,
      idiomaDetectado: idioma,
      tipo: "texto",
      timestamp: new Date().toISOString(),
    });

    res.json({ reply });
  } catch (error) {
    console.error("❌ Error general en /api/chat:", error);
    res.status(500).json({ reply: "Lo siento, ocurrió un error." });
  }
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });

  const imagePath = req.file.path;
  const optimizedPath = `uploads/optimized-${req.file.filename}`;
  const userId = req.body.userId || "desconocido";

  try {
    await sharp(imagePath)
  .rotate()
  .resize({ width: 800 })
  .jpeg({ quality: 80 })
  .toFile(optimizedPath);

    const imageUrl = `${req.protocol}://${req.get("host")}/${optimizedPath}`;

    await db.collection("mensajes").add({
  idConversacion: userId,
  rol: "usuario", // ✅ mensaje del usuario
  mensaje: imageUrl,
  original: imageUrl,
  tipo: "imagen",
  idiomaDetectado: "es",
  timestamp: new Date().toISOString(),
});

res.json({ imageUrl });
} catch (error) {
  console.error("❌ Error procesando imagen:", error);
  res.status(500).json({ error: "Error procesando la imagen" });
}
});
app.post("/api/upload-agente", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });

  const imagePath = req.file.path;
  const optimizedPath = `uploads/optimized-${req.file.filename}`;
  const userId = req.body.userId || "desconocido";
  const agenteUid = req.body.agenteUid || null;

    try {
    const imageUrl = `${req.protocol}://${req.get("host")}/${imagePath}`;

    await db.collection("mensajes").add({
      idConversacion: userId,
      rol: "asistente",
      mensaje: imageUrl,
      original: imageUrl,
      tipo: "imagen",
      idiomaDetectado: "es",
      timestamp: new Date().toISOString(),
      manual: true,
      agenteUid,
    });

    await db.collection("conversaciones").doc(userId).set(
      {
        intervenida: true,
        intervenidaPor: {
          nombre: "Agente",
          foto: "",
          uid: agenteUid,
        },
      },
      { merge: true }
    );

    res.json({ imageUrl });
  } catch (error) {
    console.error("❌ Error procesando imagen de agente:", error.message, error.stack);
    res.status(500).json({ error: "Error procesando imagen del agente" });
  }
  
});
app.post("/api/send-to-user", async (req, res) => {
  const { userId, message, agente } = req.body;
  if (!userId || !message || !agente)
    return res.status(400).json({ error: "Faltan datos" });

  try {
    const mensajesSnapshot = await db
      .collection("mensajes")
      .where("idConversacion", "==", userId)
      .where("rol", "==", "usuario")
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();

    let idiomaDestino = "es";
    if (!mensajesSnapshot.empty) {
      const ultimoMensaje = mensajesSnapshot.docs[0].data();
      idiomaDestino = ultimoMensaje.idiomaDetectado || await detectarIdiomaGPT(ultimoMensaje.original || ultimoMensaje.mensaje) || "es";
    }

    const traduccion = await traducir(message, idiomaDestino);

    await db.collection("mensajes").add({
  idConversacion: userId,
  rol: "asistente",
  mensaje: traduccion,             // ✅ lo que verá el usuario (traducido)
  original: message,               // ✅ lo que escribió el agente en el panel
  idiomaDetectado: idiomaDestino,
  tipo: "texto",
  timestamp: new Date().toISOString(),
  manual: true,
  agenteUid: agente.uid || null,
});

    await db.collection("conversaciones").doc(userId).set(
      {
        intervenida: true,
        intervenidaPor: {
          nombre: agente.nombre,
          foto: agente.foto,
          uid: agente.uid || null,
        },
      },
      { merge: true }
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("❌ Error en /api/send-to-user:", error);
    res.status(500).json({ error: "Error enviando mensaje a usuario" });
  }
});

app.post("/api/send", async (req, res) => {
  const { userId, texto } = req.body;
  if (!userId || !texto) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  try {
    const idioma = await detectarIdiomaGPT(texto);

    await db.collection("mensajes").add({
      idConversacion: userId,
      rol: "usuario",
      mensaje: texto,
      original: texto,
      idiomaDetectado: idioma,
      tipo: "texto",
      timestamp: new Date().toISOString(),
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("❌ Error guardando mensaje usuario:", error);
    res.status(500).json({ error: "Error guardando mensaje" });
  }
});

app.post("/api/marcar-visto", async (req, res) => {
  const { userId } = req.body;
  if (!userId)
    return res.status(400).json({ error: "Falta el userId" });

  try {
    await db.collection("vistas_globales").doc(userId).set({
      timestamp: new Date().toISOString(),
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ Error en /api/marcar-visto:", e);
    res.status(500).json({ error: "Error en marcar-visto" });
  }
});
app.post("/api/escribiendo", (req, res) => {
  const { userId, texto } = req.body;
  if (!userId) return res.status(400).json({ error: "Falta userId" });
  escribiendoUsuarios[userId] = texto || "";
  res.json({ ok: true });
});

app.get("/api/escribiendo/:userId", (req, res) => {
  const texto = escribiendoUsuarios[req.params.userId] || "";
  res.json({ texto });
});

app.get("/api/vistas", async (req, res) => {
  try {
    const snapshot = await db.collection("vistas_globales").get();
    const result = {};
    snapshot.forEach((doc) => {
      result[doc.id] = doc.data().timestamp;
    });
    res.json(result);
  } catch (error) {
    console.error("❌ Error obteniendo vistas:", error);
    res.status(500).json({ error: "Error obteniendo vistas" });
  }
});

app.get("/api/conversaciones", async (req, res) => {
  try {
    const snapshot = await db.collection("conversaciones").get();
    const conversaciones = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const data = doc.data();
        const userId = data.idUsuario;
        if (!userId) return null;

        let lastInteraction = data.fechaInicio;
        let lastMessageText = "";
        let mensajes = [];

        try {
          const mensajesSnapshot = await db
            .collection("mensajes")
            .where("idConversacion", "==", userId)
            .orderBy("timestamp", "desc")
            .limit(20)
            .get();

          mensajes = mensajesSnapshot.docs.map((d) => {
            const m = d.data();
            return {
              userId,
              lastInteraction: m.timestamp,
              message: m.mensaje,
              original: m.original || null,
              from: m.rol,
              tipo: m.tipo || "texto",
              estado: m.estado || null,        // ✅ Corrección aplicada aquí
              manual: m.manual || false,
            };
          });

          if (mensajes[0]) {
            lastInteraction = mensajes[0].lastInteraction;
            lastMessageText = mensajes[0].message;
          }
        } catch (e) {
          console.warn(`⚠️ No se pudo cargar mensajes para ${userId}`);
        }

        return {
          userId,
          lastInteraction,
          estado: data.estado || "abierta",
          intervenida: data.intervenida || false,
          intervenidaPor: data.intervenidaPor || null,
          pais: data.pais || "🌐",
          navegador: data.navegador || "Desconocido",
          historial: data.historial || [],
          message: lastMessageText,
          mensajes,
        };
      })
    );

    const limpias = conversaciones.filter((c) => !!c);
    res.json(limpias);
  } catch (error) {
    console.error("❌ Error obteniendo conversaciones:", error);
    res.status(500).json({ error: "Error obteniendo conversaciones" });
  }
});

app.get("/api/conversaciones/:userId", async (req, res) => {
  const { userId } = req.params;
  const desde = req.query.desde; // timestamp en formato ISO

  try {
    let query = db
      .collection("mensajes")
      .where("idConversacion", "==", userId)
      .orderBy("timestamp", "asc")
      .limit(25);

    if (desde) {
      query = query.startAfter(new Date(desde));
    }

    const snapshot = await query.get();

    const mensajes = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        if (!data || !data.timestamp || (!data.mensaje && data.tipo !== "estado")) {
          console.error("⚠️ Mensaje inválido detectado:", doc.id, data);
          return null;
        }
        return {
          id: doc.id,
          userId,
          lastInteraction: data.timestamp,
          message: data.mensaje,
          original: data.original || null,
          from: data.rol,
          tipo: data.tipo || "texto",
          manual: data.manual || false,
          estado: data.estado || null,
        };
      })
      .filter((msg) => msg !== null);

    res.json(mensajes);
  } catch (error) {
    console.error("❌ Error crítico obteniendo mensajes:", error);
    res.status(500).json({ error: "Error crítico obteniendo mensajes" });
  }
});
app.get("/api/poll/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const mensajesSnapshot = await db
      .collection("mensajes")
      .where("idConversacion", "==", userId)
      .where("manual", "==", true)
      .orderBy("timestamp")
      .get();

    const mensajes = mensajesSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        mensaje: data.mensaje,
        manual: data.manual || false,
      };
    });

    res.json({ mensajes });
  } catch (error) {
    console.error("❌ Error en /api/poll:", error);
    res.status(500).json({ error: "Error obteniendo mensajes manuales" });
  }
});

app.post("/api/liberar-conversacion", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Falta userId" });

  try {
    // 1. Marcar como no intervenida en la conversación
    await db.collection("conversaciones").doc(userId).set(
      { intervenida: false },
      { merge: true }
    );

    // 2. Guardar mensaje de tipo estado para mostrar etiqueta
    await db.collection("mensajes").add({
      idConversacion: userId,
      rol: "sistema",
      tipo: "estado",
      estado: "Traspasado a GPT", // Esta línea es imprescindible para que se muestre la etiqueta
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Conversación liberada para ${userId}`);
    res.json({ ok: true });
  } catch (error) {
    console.error("❌ Error al liberar conversación:", error);
    res.status(500).json({ error: "Error al liberar conversación" });
  }
});
app.post("/api/cerrar-chat", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Falta userId" });

  try {
    // 1. Actualizar el estado de la conversación a "cerrado"
    await db.collection("conversaciones").doc(userId).set(
      { estado: "cerrado" },
      { merge: true }
    );

    // 2. Añadir un mensaje de tipo estado para que se muestre en el historial
    await db.collection("mensajes").add({
      idConversacion: userId,
      rol: "sistema",
      tipo: "estado",
      estado: "Cerrado",
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Estado "cerrado" guardado para ${userId}`);
    res.json({ ok: true });
  } catch (error) {
    console.error("❌ Error al guardar estado cerrado:", error);
    res.status(500).json({ error: "Error guardando estado cerrado" });
  }
});

app.get("/api/estado-conversacion/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const doc = await db.collection("conversaciones").doc(userId).get();
    if (!doc.exists) return res.status(404).json({ error: "No existe conversación" });
    const data = doc.data();
    res.json({
      estado: data.estado || "abierta",
      intervenida: data.intervenida || false,
    });
  } catch (err) {
    console.error("❌ Error en /api/estado-conversacion:", err);
    res.status(500).json({ error: "Error obteniendo estado" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT} en 0.0.0.0`);
});
