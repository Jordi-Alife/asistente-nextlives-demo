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
    lower.includes("agente humano") || // ✅ aquí va la coma
    lower.includes("hablar con persona humana") ||
    lower.includes("hablar con un agente") ||
    lower.includes("hablar con humano") ||
    lower.includes("quiero una persona")
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

  // 🧠 Detectar idioma del mensaje
  let idiomaDetectado = await detectarIdiomaGPT(message);
  let idioma = idiomaDetectado;

  // 🛡️ Fallback si no es válido
  if (!idioma || idioma === "zxx") {
    const ultimos = await db.collection("mensajes")
      .where("idConversacion", "==", finalUserId)
      .where("rol", "==", "usuario")
      .orderBy("timestamp", "desc")
      .limit(10)
      .get();

    const idiomaValido = ultimos.docs.find(doc => {
      const msg = doc.data();
      return msg.idiomaDetectado && msg.idiomaDetectado !== "zxx";
    });

    if (idiomaValido) {
      idioma = idiomaValido.data().idiomaDetectado;
      console.log(`🌐 Fallback idioma en /chat: se usa anterior "${idioma}"`);
    } else {
      idioma = "es";
      console.log(`⚠️ Fallback total en /chat: se usa "es"`);
    }
  }

  try {
    // Guardar info usuario
    await db.collection("usuarios_chat").doc(finalUserId).set(
      {
        nombre: "Invitado",
        idioma,
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
    ultimaRespuesta: new Date().toISOString(),
    lastMessage: message,
    estado: "abierta",
    idioma,
    navegador: userAgent || "",
    pais: pais || "",
    historial: historial || [],
    datosContexto: datosContexto || null,
    noVistos: admin.firestore.FieldValue.increment(1),
  },
  { merge: true }
);

// Traducir mensaje para guardar en español (para el panel)
const traduccionUsuario = await traducir(message, "es");

// Guardamos el timestamp manualmente para usarlo luego
const timestampEnvio = new Date();

await db.collection("mensajes").add({
  idConversacion: finalUserId,
  rol: "usuario",
  mensaje: traduccionUsuario,
  original: message,
  idiomaDetectado: idioma,
  tipo: "texto",
  timestamp: timestampEnvio.toISOString(), // ✅ usamos este timestamp exacto
});

// ⏱️ SMS si en 60s no responde un agente en conversación intervenida (solo una vez por intervención)
setTimeout(async () => {
  console.log("⏱️ Verificando respuesta del agente tras 60s...");

  try {
    const convRef = db.collection("conversaciones").doc(finalUserId);
    const convDoc = await convRef.get();
    const convData = convDoc.exists ? convDoc.data() : null;

    if (!convData?.intervenida) {
      console.log("ℹ️ La conversación no está intervenida, no se envía SMS.");
      return;
    }

    const timestampIntervencion = convData.timestampIntervencion
      ? new Date(convData.timestampIntervencion)
      : null;

    if (!timestampIntervencion) {
      console.log("⚠️ No hay timestamp de intervención. Abortando verificación.");
      return;
    }

    const ultimos = await db.collection("mensajes")
      .where("idConversacion", "==", finalUserId)
      .orderBy("timestamp", "desc")
      .limit(20)
      .get();

    const mensajes = ultimos.docs.map(doc => doc.data());
    const ultimoUsuario = mensajes.find(m =>
      m.rol === "usuario" &&
      new Date(m.timestamp) > timestampIntervencion
    );

    if (!ultimoUsuario) {
      console.log("ℹ️ No hay mensaje del usuario posterior a la intervención.");
      return;
    }

    const tsUsuario = new Date(ultimoUsuario.timestamp);
    console.log("⏱️ Último mensaje del usuario tras intervención:", tsUsuario.toISOString());

    const huboRespuesta = mensajes.some(m =>
      m.manual === true && new Date(m.timestamp) > tsUsuario
    );

    console.log("¿Respuesta posterior del agente?", huboRespuesta);

    if (huboRespuesta) {
      console.log("✅ El agente respondió, no se envía SMS.");
      return;
    }

    const smsPrevio = convData.ultimoSMSPost60s
      ? new Date(convData.ultimoSMSPost60s)
      : null;

    if (smsPrevio && smsPrevio > tsUsuario) {
      console.log("❌ Ya se envió un SMS después de ese mensaje. Cancelando.");
      return;
    }

    console.log("❗ No hubo respuesta del agente, preparando SMS...");

    const agentesSnapshot = await db.collection("agentes").get();
    const agentes = agentesSnapshot.docs
      .map(doc => doc.data())
      .filter(a => a.notificarSMS && a.telefono);

    console.log("Agentes notificados:", agentes.map(a => a.telefono));

    const texto = `¡Recuerda! Tienes un mensaje de ${finalUserId} pendiente de respuesta. Entra al panel para contestar.`;
    const token = process.env.SMS_ARENA_KEY;

    if (!token) {
      console.warn("⚠️ TOKEN vacío: variable SMS_ARENA_KEY no está definida");
      return;
    }

    for (const agente of agentes) {
      const telefono = agente.telefono.toString().replace(/\s+/g, "");
      if (!telefono) continue;

      const smsId = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
      const params = new URLSearchParams();
      params.append("id", smsId);
      params.append("auth_key", token);
      params.append("from", "NextLives");
      params.append("to", telefono);
      params.append("text", texto);

      try {
        const response = await fetch("http://api.smsarena.es/http/sms.php", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString()
        });
        const respuestaSMS = await response.text();
        console.log(`📨 SMS post-60s enviado a ${telefono}:`, respuestaSMS);
      } catch (err) {
        console.warn(`❌ Error al enviar SMS a ${telefono}:`, err);
      }
    }

    // ✅ Registrar que ya se envió
    await convRef.set({ ultimoSMSPost60s: new Date().toISOString() }, { merge: true });

  } catch (error) {
    console.error("❌ Error en lógica post-60s sin respuesta:", error);
  }
}, 60000); // 60 segundos

// Intervención activa: no responder
const convDoc = await db.collection("conversaciones").doc(finalUserId).get();
const convData = convDoc.exists ? convDoc.data() : null;
if (convData?.intervenida) {
  console.log(`🤖 GPT desactivado: conversación intervenida para ${finalUserId}`);
  return res.json({ reply: "" });
}

    console.log("🧪 Mensaje recibido:", message);

    if (shouldEscalateToHuman(message)) {
  console.log("🚨 Escalada activada por mensaje:", message);

  const convRef = db.collection("conversaciones").doc(finalUserId);
  const convSnap = await convRef.get();
  const convData = convSnap.exists ? convSnap.data() : {};

  const necesitaEscalada = !convData.intervenida; // ✅ simplificado

  if (necesitaEscalada) {
    await convRef.set(
      {
        pendienteIntervencion: true,
        intervenida: true,
        timestampIntervencion: new Date().toISOString(), // ✅ NUEVO CAMPO para lógica SMS
      },
      { merge: true }
    );

    const agentesSnapshot = await db.collection("agentes").get();
    const agentes = agentesSnapshot.docs
      .map(doc => doc.data())
      .filter(a => a.notificarSMS && a.telefono);

    const urlPanel = `https://panel-gestion-chats-production.up.railway.app/conversaciones?userId=${finalUserId}`;
    const texto = `El usuario ${finalUserId} ha solicitado hablar con un Agente. Accede al panel: ${urlPanel}`;
    const token = process.env.SMS_ARENA_KEY;

    if (!token) {
      console.warn("⚠️ TOKEN vacío: variable SMS_ARENA_KEY no está definida");
    } else {
      for (const agente of agentes) {
        const telefono = agente.telefono.toString().replace(/\s+/g, "");
        if (!telefono) continue;

        const smsId = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
        const params = new URLSearchParams();
        params.append("id", smsId);
        params.append("auth_key", token);
        params.append("from", "NextLives");
        params.append("to", telefono);
        params.append("text", texto);

        try {
          const response = await fetch("http://api.smsarena.es/http/sms.php", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString()
          });
          const respuestaSMS = await response.text();
          console.log(`✅ SMS enviado a ${telefono}:`, respuestaSMS);
        } catch (err) {
          console.warn(`❌ Error al enviar SMS a ${telefono}:`, err);
        }
      }
    }
  }
}

    // Preparar prompt
    const baseConocimiento = fs.existsSync("./base_conocimiento_actualizado.txt")
      ? fs.readFileSync("./base_conocimiento_actualizado.txt", "utf8")
      : "";

    const historialMensajes = await obtenerUltimosMensajesUsuario(finalUserId);
    const historialFormateado = formatearHistorialParaPrompt(historialMensajes);

    const promptSystem = [
      baseConocimiento,
      `\nHistorial reciente de conversación:\n${historialFormateado}`,
      datosContexto ? `\nInformación adicional de contexto JSON:\n${JSON.stringify(datosContexto)}` : "",
      `IMPORTANTE: Responde siempre en el idioma detectado del usuario: "${idioma}".`,
    ].join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: promptSystem },
        { role: "user", content: message },
      ],
    });

    const reply = response.choices[0].message.content;

    const traduccionRespuesta = await traducir(reply, "es");

    await db.collection("mensajes").add({
      idConversacion: finalUserId,
      rol: "asistente",
      mensaje: traduccionRespuesta,
      original: reply,
      idiomaDetectado: idioma,
      tipo: "texto",
      timestamp: new Date().toISOString(),
    });

    // ✅ Etiqueta "Intervenida" se añade después del mensaje GPT
    if (shouldEscalateToHuman(message)) {
      await db.collection("mensajes").add({
        idConversacion: finalUserId,
        rol: "sistema",
        tipo: "estado",
        estado: "Intervenida",
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ reply });
  } catch (error) {
    console.error("❌ Error general en /api/chat:", error);
    res.status(500).json({ reply: "Lo siento, ocurrió un error." });
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
    ultimaRespuesta: new Date().toISOString(),   // ✅ nuevo campo
    lastMessage: imageUrl,                       // ✅ nuevo campo
  },
  { merge: true }
);

    res.json({ imageUrl });
  } catch (error) {
    console.error("❌ Error procesando imagen de agente:", error.message, error.stack);
    res.status(500).json({ error: "Error procesando imagen del agente" });
  }
  
});

// ✅ NUEVO endpoint para subir imágenes desde el asistente (usuario)
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });

  const imagePath = req.file.path;
  const userId = req.body.userId || "desconocido";

  try {
    const imageUrl = `${req.protocol}://${req.get("host")}/${imagePath}`;

    await db.collection("mensajes").add({
      idConversacion: userId,
      rol: "usuario",
      mensaje: imageUrl,
      original: imageUrl,
      tipo: "imagen",
      idiomaDetectado: "es",
      timestamp: new Date().toISOString(),
    });

    res.json({ imageUrl });
  } catch (error) {
    console.error("❌ Error procesando imagen del usuario:", error.message, error.stack);
    res.status(500).json({ error: "Error procesando imagen del usuario" });
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
    ultimaRespuesta: new Date().toISOString(),  // ✅ nuevo campo
    lastMessage: traduccion,                    // ✅ nuevo campo
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
    let idioma = await detectarIdiomaGPT(texto);

// Fallback si no se detecta un idioma válido
if (!idioma || idioma === "zxx") {
  const ultimos = await db.collection("mensajes")
    .where("idConversacion", "==", userId)
    .where("rol", "==", "usuario")
    .orderBy("timestamp", "desc")
    .limit(10)
    .get();

  const idiomaValido = ultimos.docs.find(doc => {
    const msg = doc.data();
    return msg.idiomaDetectado && msg.idiomaDetectado !== "zxx";
  });

  if (idiomaValido) {
    idioma = idiomaValido.data().idiomaDetectado;
    console.log(`🌐 Fallback idioma en /send: se usa anterior "${idioma}"`);
  } else {
    idioma = "es";
    console.log(`⚠️ Fallback total en /send: se usa "es"`);
  }
}

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
  if (!userId) return res.status(400).json({ error: "Falta el userId" });

  const now = new Date().toISOString();

  try {
    // 1. Guardar timestamp de vista global
    await db.collection("vistas_globales").doc(userId).set({ timestamp: now });

    // 2. Contar mensajes no vistos (últimos 50)
    const mensajesSnapshot = await db
      .collection("mensajes")
      .where("idConversacion", "==", userId)
      .where("rol", "==", "usuario")
      .orderBy("timestamp", "desc")
      .limit(50)
      .get();

    let noVistos = 0;
    for (const doc of mensajesSnapshot.docs) {
      const msg = doc.data();
      if (msg.timestamp > now) {
        noVistos++;
      }
    }

    // 3. Guardar conteo en la conversación
    await db.collection("conversaciones").doc(userId).set(
      { noVistos: noVistos },
      { merge: true }
    );

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
    const conversaciones = snapshot.docs.map((doc) => {
      const data = doc.data();
      const userId = data.idUsuario;
      if (!userId) return null;

      return {
  userId,
  lastInteraction: data.ultimaRespuesta || data.fechaInicio || new Date().toISOString(),
  estado: data.estado || "abierta",
  intervenida: data.intervenida || false,
  intervenidaPor: data.intervenidaPor || null,
  pais: data.pais || "🌐",
  navegador: data.navegador || "Desconocido",
  historial: data.historial || [],
  message: data.lastMessage || "",
  mensajes: [],
  noVistos: data.noVistos || 0, // ✅ este es el campo que debe usar el frontend
};
    }).filter((c) => !!c);

    res.json(conversaciones);
  } catch (error) {
    console.error("❌ Error obteniendo conversaciones:", error);
    res.status(500).json({ error: "Error obteniendo conversaciones" });
  }
});

app.get("/api/conversaciones/:userId", async (req, res) => {
  const { userId } = req.params;
  const hasta = req.query.hasta; // timestamp ISO

  try {
    let query = db
      .collection("mensajes")
      .where("idConversacion", "==", userId)
      .orderBy("timestamp", "desc")
      .limit(25);

    if (hasta) {
      query = query.where("timestamp", "<", new Date(hasta)); // trae más antiguos
    }

    const snapshot = await query.get();

    const mensajes = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        if (!data || !data.timestamp || (!data.mensaje && data.tipo !== "estado")) return null;
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
      .filter((msg) => msg !== null)
      .sort((a, b) => new Date(a.lastInteraction) - new Date(b.lastInteraction)); // orden ascendente

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
    // 1. Marcar como no intervenida y permitir futuros SMS
    await db.collection("conversaciones").doc(userId).set(
      {
        intervenida: false,
        smsIntervencionEnviado: false, // ✅ Reinicia para permitir nuevos SMS
      },
      { merge: true }
    );

    // 2. Guardar mensaje de tipo estado para mostrar etiqueta
    await db.collection("mensajes").add({
      idConversacion: userId,
      rol: "sistema",
      tipo: "estado",
      estado: "Traspasado a GPT",
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
    // 1. Actualizar el estado de la conversación a "cerrado" y liberar
    await db.collection("conversaciones").doc(userId).set(
      {
        estado: "cerrado",
        intervenida: false,
        smsIntervencionEnviado: false,
      },
      { merge: true }
    );

    // 2. Añadir mensaje tipo estado "Cerrado"
    await db.collection("mensajes").add({
      idConversacion: userId,
      rol: "sistema",
      tipo: "estado",
      estado: "Cerrado",
      timestamp: new Date().toISOString(),
    });

    // 3. Añadir mensaje tipo estado "Traspasado a GPT"
    await db.collection("mensajes").add({
      idConversacion: userId,
      rol: "sistema",
      tipo: "estado",
      estado: "Traspasado a GPT",
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Conversación cerrada y liberada para ${userId}`);
    res.json({ ok: true });
  } catch (error) {
    console.error("❌ Error al cerrar y liberar conversación:", error);
    res.status(500).json({ error: "Error al cerrar conversación" });
  }
});;
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

async function obtenerUltimosMensajesUsuario(userId, limite = 6) {
  const snapshot = await db
    .collection("mensajes")
    .where("idConversacion", "==", userId)
    .orderBy("timestamp", "desc")
    .limit(limite)
    .get();

  const mensajes = snapshot.docs.map(doc => doc.data());

  // Ordenar de más antiguos a más recientes
  return mensajes.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// NUEVA función para formatear historial como texto tipo diálogo
function formatearHistorialParaPrompt(mensajes) {
  return mensajes.map(msg => {
    const autor = msg.rol === 'usuario' ? 'Usuario' : 'Asistente';
    return `${autor}: ${msg.mensaje}`;
  }).join('\n');
}

app.get("/api/test-historial/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const ultimos = await obtenerUltimosMensajesUsuario(userId);
    res.json(ultimos);
  } catch (e) {
    console.error("❌ Error al obtener historial:", e);
    res.status(500).json({ error: "Error consultando historial" });
  }
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT} en 0.0.0.0`);
});
