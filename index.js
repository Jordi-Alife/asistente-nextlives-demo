import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import multer from "multer";
import path from "path";
import fs from "fs";
import admin from "firebase-admin";
import serviceAccount from "./serviceAccountKey.json" assert { type: "json" };
import { llamarWebhookContexto } from "./webhookContexto.js";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const app = express();
const PORT = process.env.PORT || 80;
const HISTORIAL_PATH = "./historial.json";

let conversaciones = [];
let intervenidas = {};
let vistasPorAgente = {};
let escribiendoUsuarios = {};

/**
 * ✅ Función central para marcar una conversación como intervenida
 * Puede llamarse desde el panel o desde el backend cuando un usuario lo solicita
 */
async function marcarComoIntervenida(userId, agente = null) {
  if (!userId) return;

  try {
    const convRef = db.collection("conversaciones").doc(userId);
    await convRef.set(
      {
        intervenida: true,
        estado: "abierta",
        intervenidaPor: agente || null,
        ultimaRespuesta: new Date().toISOString(),
      },
      { merge: true }
    );

    // ✅ Guardar mensaje de estado (evita duplicados)
    const mensajesRef = db.collection("mensajes");
    const yaExiste = await mensajesRef
      .where("idConversacion", "==", userId)
      .where("tipo", "==", "estado")
      .where("estado", "==", "Intervenida")
      .limit(1)
      .get();

    if (yaExiste.empty) {
      await mensajesRef.add({
        idConversacion: userId,
        rol: "sistema",
        mensaje: "Intervenida",
        tipo: "estado",
        estado: "Intervenida",
        timestamp: new Date().toISOString(),
        lastInteraction: new Date().toISOString(),
      });
    }

    console.log(`✅ Conversación ${userId} marcada como intervenida`);
  } catch (error) {
    console.error("❌ Error al marcar como intervenida:", error);
  }
}

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

// Configurar orígenes permitidos con lógica flexible
const allowedOrigins = [
  process.env.PANEL_GESTION_URL, // URL dinámica del panel de gestión
  'http://localhost'
].filter(Boolean); // Filtra valores undefined o null

// Función para verificar si el origen está permitido
function isOriginAllowed(origin) {
  if (!origin) return true; // Solicitudes sin origen (Postman, apps móviles, etc.)
  
  // Permitir orígenes específicos en la lista
  if (allowedOrigins.includes(origin)) return true;
  
  // Permitir localhost CON cualquier puerto (desarrollo)
  if (origin.match(/^http:\/\/localhost:\d+$/) || origin.match(/^http:\/\/127\.0\.0\.1:\d+$/)) {
    return true;
  }
  
  // Permitir https localhost en cualquier puerto (desarrollo con SSL)
  if (origin.match(/^https:\/\/localhost:\d+$/) || origin.match(/^https:\/\/127\.0\.0\.1:\d+$/)) {
    return true;
  }
  
  // Permitir 127.0.0.1 SIN puerto
  if (origin === "http://127.0.0.1" || origin === "https://127.0.0.1") {
    return true;
  }
  
  // Permitir el propio dominio (donde está desplegada la aplicación)
  if (process.env.RAILWAY_STATIC_URL && origin === `https://${process.env.RAILWAY_STATIC_URL}`) {
    return true;
  }
  
  // Para otros servicios de hosting, permitir el dominio actual
  const currentHost = process.env.HOST || process.env.VERCEL_URL || process.env.RENDER_EXTERNAL_URL;
  if (currentHost && origin === `https://${currentHost}`) {
    return true;
  }
  
  return false;
}

app.use(cors({
  origin: function (origin, callback) {
    console.log("🌐 Solicitud CORS desde origen:", origin);
    
    if (isOriginAllowed(origin)) {
      console.log("✅ Origen permitido:", origin || "sin origen");
      return callback(null, true);
    }
    
    console.warn("❌ CORS bloqueado para origen:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200 // Para compatibilidad con navegadores legacy
}));

// 👇 Añade esta línea justo después para permitir solicitudes OPTIONS
app.options("*", cors());
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
// ✅ NUEVA FUNCIÓN: genera saludo según hora e idioma
function obtenerSaludoHoraActual(idioma = "es") {
  const hora = new Date().getHours();

  if (idioma === "en") {
    if (hora < 12) return "Good morning";
    if (hora < 20) return "Good afternoon";
    return "Good evening";
  }

  // Español (por defecto)
  if (hora < 12) return "Buenos días";
  if (hora < 20) return "Buenas tardes";
  return "Buenas noches";
}

// Función para llamar al webhook de contexto con firma
app.post("/api/chat", async (req, res) => {
  const { message, system, userId, userAgent, pais, historial, userUuid, lineUuid, language } = req.body;
  const finalUserId = userId || "anon";

  // ✅ Si el chat estaba cerrado y el usuario vuelve a escribir, reabrir la conversación
const convRef = db.collection("conversaciones").doc(finalUserId);
const convSnap = await convRef.get();
if (convSnap.exists && convSnap.data().chatCerrado === true) {
  await convRef.update({ chatCerrado: false, estado: "abierta" });
  console.log(`🔓 Conversación ${finalUserId} reabierta al recibir mensaje del usuario`);
}

  // Llamar al webhook de contexto solo si existen userUuid y lineUuid
const datosContextoFrontend = req.body.datosContexto || {};
let datosContexto = {};

if (userUuid && lineUuid) {
  const datosDelWebhook = await llamarWebhookContexto({ userUuid, lineUuid });
  console.log("🧩 Datos desde webhook:", datosDelWebhook);

  // ✅ Extraer solo campos necesarios
  const nombreUsuario = datosContextoFrontend?.user?.name || datosDelWebhook?.user?.name || null;
  const nombreDifunto = datosContextoFrontend?.line?.name || datosDelWebhook?.line?.name || null;
  const nombreFuneraria = datosContextoFrontend?.line?.company?.name || datosDelWebhook?.line?.company?.name || null;

  // ✅ Limitar el JSON a lo esencial
  datosContexto = {
    user: { name: nombreUsuario },
    line: { name: nombreDifunto },
    company: { name: nombreFuneraria }
  };
} else {
  // En caso de no haber webhooks, solo se extraen valores del frontend y se recortan
  const nombreUsuario = datosContextoFrontend?.user?.name || null;
  const nombreDifunto = datosContextoFrontend?.line?.name || null;
  const nombreFuneraria = datosContextoFrontend?.line?.company?.name || null;

  datosContexto = {
    user: { name: nombreUsuario },
    line: { name: nombreDifunto },
    company: { name: nombreFuneraria }
  };
}

console.log("🧪 Nombre que usará el backend para el saludo:", datosContexto?.user?.name || datosContexto?.nombre);

  // ✅ Si el mensaje es "__saludo_inicial__", devolver un saludo personalizado
if (message === '__saludo_inicial__') {
  const saludo = obtenerSaludoHoraActual(language || idioma);

  const nombre =
    datosContexto?.user?.name?.trim() ||
    datosContexto?.nombre?.trim() || null;

  console.log("👋 Nombre extraído para saludo:", nombre);

  const saludoFinal = nombre
    ? `${saludo}, ${nombre}, ¿en qué puedo ayudarte?`
    : `${saludo}, ¿en qué puedo ayudarte?`;

  // ✅ GUARDAR DATOS EN FIRESTORE ANTES DE RESPONDER
  try {
    await db.collection("conversaciones").doc(userId).set(
      {
        datosContexto: datosContexto || null,
        idiomaDetectado: language || idioma || "es",
        actualizado: new Date().toISOString(),
      },
      { merge: true }
    );
    console.log("✅ datosContexto guardado al abrir el chat");
  } catch (err) {
    console.error("❌ Error al guardar datosContexto:", err);
  }

  // ✅ Enviar mensaje de saludo al chat
  await db.collection("mensajes").add({
    idConversacion: finalUserId,
    rol: "asistente",
    mensaje: saludoFinal,
    original: saludoFinal,
    idiomaDetectado: language,
    tipo: "texto",
    timestamp: new Date().toISOString(),
  });

  return res.json({ reply: saludoFinal });
}
  // 🧠 Detectar idioma del mensaje
  let idiomaDetectado = await detectarIdiomaGPT(message);
  let idioma = idiomaDetectado;

// Fallback si no es válido
if (!idioma || idioma === "zxx") {
  const convDoc = await db.collection("conversaciones").doc(userId).get();
  const convData = convDoc.exists ? convDoc.data() : null;

  // 1. Fallback a idioma de conversación
  if (convData?.idioma && convData.idioma !== "zxx") {
    idioma = convData.idioma;
    console.log(`🌐 Fallback idioma desde conversación: ${idioma}`);
  }
  // 2. Fallback a language de chatSystem (si existe)
  else if (convData?.language && typeof convData.language === "string") {
    idioma = convData.language;
    console.log(`🌐 Fallback idioma desde chatSystem.language: ${idioma}`);
  }
  // 3. Fallback final a español
  else {
    idioma = "es";
    console.log(`⚠️ Fallback total a "es"`);
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
    userUuid: req.body.userUuid || null,
    lineUuid: req.body.lineUuid || null,
    chatIdiomaDetectado: req.body.language || idioma
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

  const necesitaEscalada = !convData.intervenida;

  if (necesitaEscalada) {
    await marcarComoIntervenida(finalUserId); // 👈 UNIFICADO ✅

    await convRef.set(
      {
        pendienteIntervencion: true,
        timestampIntervencion: new Date().toISOString(),
      },
      { merge: true }
    );

    const agentesSnapshot = await db.collection("agentes").get();
    const agentes = agentesSnapshot.docs
      .map(doc => doc.data())
      .filter(a => a.notificarSMS && a.telefono);

    const urlPanel = `${process.env.PANEL_GESTION_URL}/conversaciones?userId=${finalUserId}`;
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

  // ✅ Preparar prompt
const baseConocimiento = fs.existsSync("./base_conocimiento_actualizado.txt")
  ? fs.readFileSync("./base_conocimiento_actualizado.txt", "utf8")
  : "";

// No cargamos historial completo para evitar consumo innecesario
let historialFormateado = ""; // ← Vacío intencionadamente

// ⚠️ Ya no lo cargamos desde Firestore ni lo reenviamos
/*
try {
  const convDoc2 = await db.collection("conversaciones").doc(finalUserId).get();
  historialFormateado = convDoc2.exists && convDoc2.data().historialFormateado
    ? convDoc2.data().historialFormateado
    : "";

  await db.collection("conversaciones").doc(finalUserId).set(
    { historialFormateado },
    { merge: true }
  );
  console.log("✅ Historial formateado cargado:", historialFormateado);
} catch (err) {
  console.warn("⚠️ No se pudo cargar o guardar historial formateado:", err);
}
*/

// ✅ Resumen ligero de contexto (nombre usuario, difunto, funeraria)
const nombreUsuario = datosContexto?.user?.name?.trim() || datosContexto?.nombre?.trim() || null;
const nombreDifunto = datosContexto?.line?.name?.trim() || null;
const nombreFuneraria = datosContexto?.line?.company?.name?.trim() || null;

const resumenContexto =
  [nombreUsuario, nombreDifunto, nombreFuneraria].filter(Boolean).length > 0
    ? `Información adicional: el usuario se llama ${nombreUsuario || "desconocido"}, escribe desde la web de ${nombreDifunto || "desconocido"}, que pertenece a la funeraria ${nombreFuneraria || "desconocida"}.`
    : "";

const promptSystem = [
  baseConocimiento,
  resumenContexto,
  `IMPORTANTE: Responde siempre en el idioma detectado del usuario: "${idioma}".`,
  `IMPORTANTE: Si el usuario indica que quiere hablar con una persona, agente o humano, no insistas ni pidas más detalles. Solo responde con un mensaje claro diciendo que se le va a transferir a un agente humano. No digas que "intentarás ayudar". Simplemente confirma que será derivado.`,
].join("\n");

console.log("🧠 promptSystem generado:", promptSystem);

// ✅ Generar saludo si es el primer mensaje
let saludoInicial = "";
if (!historialFormateado || historialFormateado.trim() === "") {
  const saludo = obtenerSaludoHoraActual(idioma);
  const nombre = datosContexto?.user?.name || null;

  saludoInicial = nombre
    ? `${saludo}, ${nombre}. `
    : `${saludo}. `;
  console.log("👋 Se ha generado saludo inicial:", saludoInicial);
}

console.log("📨 Enviando a OpenAI:", saludoInicial + message);

let reply = "";
try {
  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: promptSystem },
      { role: "user", content: saludoInicial + message },
    ],
  });
  console.log("✅ Respuesta recibida de OpenAI:", response);
  reply = response.choices[0].message.content;
  console.log("💬 Respuesta GPT extraída:", reply);
} catch (err) {
  console.error("❌ ERROR AL LLAMAR A OPENAI:", err);
  return res.status(500).json({ reply: "Lo siento, no pude obtener respuesta del asistente." });
}

const traduccionRespuesta = await traducir(reply, "es");
console.log("🌍 Traducción al español:", traduccionRespuesta);

// ✅ Guardar mensaje del asistente (traducido para el panel)
await db.collection("mensajes").add({
  idConversacion: finalUserId,
  rol: "asistente",
  mensaje: traduccionRespuesta,
  original: reply,
  idiomaDetectado: idioma,
  tipo: "texto",
  timestamp: new Date().toISOString(),
});
console.log("📝 Mensaje guardado en Firestore correctamente.");

// ✅ Guardar historial formateado optimizado en el documento de la conversación
// Limitamos a las últimas 20 líneas del historial para evitar exceso de tokens
let historialRecortado = "";
if (historialFormateado && historialFormateado.trim() !== "") {
  const lineas = historialFormateado.split("\n");
  const ultimasLineas = lineas.slice(-20); // puedes ajustar a -10 o -30 si quieres
  historialRecortado = ultimasLineas.join("\n");
}

const nuevoHistorial = `${historialRecortado}\nUsuario: ${message}\nAsistente: ${reply}`;

await db.collection("conversaciones").doc(finalUserId).set(
  { historialFormateado: nuevoHistorial },
  { merge: true }
);
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

    res.json({ 
  reply, 
  intervenida: convData?.intervenida || false 
});
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
    estado: "abierta", // ✅ reactiva la conversación si estaba cerrada o archivada
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
    let idiomaDestino = "es";
try {
  const convDoc = await db.collection("conversaciones").doc(userId).get();
  const idioma = convDoc.exists ? convDoc.data().idioma : null;

  if (idioma && idioma !== "und" && idioma !== "zxx") {
    idiomaDestino = idioma;
    console.log("🌐 Idioma extraído de conversación:", idiomaDestino);
  } else {
    console.warn("⚠️ Idioma inválido o no definido. Se usará fallback 'es'");
  }
} catch (e) {
  console.warn("⚠️ Error leyendo idioma desde conversación:", e);
}
    const traduccion = await traducir(message, idiomaDestino);

    const timestampAhora = new Date().toISOString();

// ✅ Reactivar conversación si estaba cerrada o archivada
await db.collection("conversaciones").doc(userId).set(
  { estado: "abierta" },
  { merge: true }
);

if (req.body.imageUrl || message) {
  await db.collection("mensajes").add({
    idConversacion: userId,
    rol: "asistente",
    mensaje: req.body.imageUrl || traduccion,
    original: req.body.imageUrl || message,
    idiomaDetectado: idiomaDestino,
    tipo: req.body.imageUrl ? "imagen" : "texto",
    timestamp: timestampAhora,
    manual: true,
    agenteUid: agente.uid || null,
  });
}

const convDoc = await db.collection("conversaciones").doc(userId).get();
const historialPrevio = convDoc.exists && convDoc.data().historialFormateado
  ? convDoc.data().historialFormateado
  : "";

const nuevoHistorial = historialPrevio
  ? `${historialPrevio}\nAsistente: ${message}`
  : `Asistente: ${message}`;

await db.collection("conversaciones").doc(userId).set(
  {
    historialFormateado: nuevoHistorial,
    ultimaRespuesta: timestampAhora,
    lastMessage: traduccion,
  },
  { merge: true }
);

// ✅ Marcamos la conversación como intervenida de forma centralizada
await marcarComoIntervenida(userId, {
  nombre: agente.nombre,
  foto: agente.foto,
  uid: agente.uid || null,
});

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
      if (new Date(msg.timestamp) > new Date(now)) {
        noVistos++;
      }
    }

    // 3. Guardar conteo en la conversación
    await db.collection("conversaciones").doc(userId).set(
      { noVistos },
      { merge: true }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ Error en /api/marcar-visto:", e);
    res.status(500).json({ error: "Error en marcar-visto" });
  }
});
app.post("/api/escribiendo", async (req, res) => {
  const { userId, texto } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "Falta userId" });
  }

  try {
    const ref = firestore.collection("escribiendo").doc(userId);
    await ref.set(
      {
        texto: texto || "",
        timestamp: Date.now()
      },
      { merge: true }
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ Error al guardar texto escribiendo:", err);
    res.status(500).json({ error: "Error al guardar texto escribiendo" });
  }
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
  const tipoRaw = req.query.tipo || "recientes";
  const tipo = tipoRaw === "archivadas" ? "archivo" : tipoRaw;

  console.log("🧭 [GET] /api/conversaciones desde", req.headers.origin, req.headers["user-agent"]);

  try {
    console.log("📥 [GET] /api/conversaciones → tipo:", tipo);

    let filtroEstados = [];

if (tipo === "recientes") {
  filtroEstados = ["abierta"];
} else if (tipo === "archivo" || tipo === "archivadas") {
  filtroEstados = ["cerrado", "archivado"];
}

let query = db.collection("conversaciones");
if (filtroEstados.length > 0) {
  query = query.where("estado", "in", filtroEstados);
}

const snapshot = await query.get();
    const ahora = new Date();

    const todas = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const userId = data.idUsuario;
      if (!userId) continue;

      // 🔍 Log por conversación
      console.log(`📄 Procesando conversación ${userId} con estado: ${data.estado}`);

      const ultima = data.ultimaRespuesta || data.fechaInicio;
      const minutos = ultima ? (ahora - new Date(ultima)) / 60000 : Infinity;

      // Si lleva inactiva más de 5 minutos y no está cerrada ni archivada, marcar como archivada
      const estadoRaw = (data.estado || "").toLowerCase();
      if (minutos > 5 && (data.estado || "").toLowerCase() === "abierta") {
  db.collection("conversaciones").doc(userId).set(
    { estado: "archivado" },
    { merge: true }
  );
  data.estado = "archivado"; // para que se devuelva actualizado
  console.log(`✅ Conversación archivada automáticamente: ${userId}`);
}

        todas.push({
    userId,
    lastInteraction: ultima || new Date().toISOString(),
    estado: data.estado || "abierta",
    intervenida: data.intervenida || false,
    intervenidaPor: data.intervenidaPor || null,
    pais: data.pais || "🌐",
    navegador: data.navegador || "Desconocido",
    historial: data.historial || [],
    message: data.lastMessage || "",
    mensajes: [],
    noVistos: data.noVistos || 0,
    datosContexto: data.datosContexto || null // 👈 AÑADIR ESTA LÍNEA
  });
    }

    let filtradas = todas;

    if (tipo === "recientes") {
  filtradas = todas.filter(
    (c) =>
      (c.estado || "").toLowerCase() !== "cerrado" &&
      (c.estado || "").toLowerCase() !== "archivado"
  );
} else if (tipo === "archivo" || tipo === "archivadas") {
  filtradas = todas.filter(
    (c) =>
      (c.estado || "").toLowerCase() === "cerrado" ||
      (c.estado || "").toLowerCase() === "archivado"
  );
}

    res.json(filtradas);
  } catch (error) {
    console.error("❌ Error obteniendo conversaciones:", error);
    res.status(500).json({ error: "Error obteniendo conversaciones" });
  }
});

app.get("/api/conversaciones/:userId", async (req, res) => {
  const { userId } = req.params;
  const hasta = req.query.hasta;

  console.log(`📥 [GET] /api/conversaciones/${userId} → hasta=${hasta || "sin límite"}`);

  try {
    let query = db
      .collection("mensajes")
      .where("idConversacion", "==", userId)
      .orderBy("timestamp", "desc")
      .limit(25);

    if (hasta) {
      query = query.where("timestamp", "<", new Date(hasta));
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

    console.log(`📦 Devueltos ${mensajes.length} mensajes para ${userId}`);
    res.json(mensajes);
  } catch (err) {
    console.error("❌ Error cargando mensajes:", err);
    res.status(500).send("Error");
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
        manual: data.manual || false
      };
    });

    res.json({ mensajes }); // ✅ Esto es lo que espera el frontend
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

// Middleware de fallback para garantizar CORS en cualquier respuesta
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Si el origen está en la lista de permitidos, usarlo; si no, usar wildcard solo para desarrollo
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    // Para requests sin origen (Postman, apps móviles)
    res.header("Access-Control-Allow-Origin", "*");
  } else {
    // Para desarrollo local, permitir localhost
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      res.header("Access-Control-Allow-Origin", origin);
    } else {
      res.header("Access-Control-Allow-Origin", process.env.PANEL_GESTION_URL || "*");
    }
  }
  
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

// Middleware global para capturar errores y responder con CORS
app.use((err, req, res, next) => {
  console.error("❌ Error capturado:", err.stack || err);
  
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  } else {
    res.header("Access-Control-Allow-Origin", process.env.PANEL_GESTION_URL || "*");
  }
  
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.status(500).json({ error: "Error interno del servidor" });
  res.json({ error: "Error interno del servidor" });
});

app.get("/api/nombre-funeraria/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const doc = await db.collection("conversaciones").doc(userId).get();
    if (!doc.exists) {
      return res.status(404).json({ nombre: "Canal Digital" });
    }

    const data = doc.data();
    const nombre = data?.datosContexto?.line?.company?.name || "Canal Digital";

    res.json({ nombre });
  } catch (err) {
    console.error("❌ Error en /api/nombre-funeraria:", err);
    res.status(500).json({ nombre: "Canal Digital" });
  }
});

app.get("/api/contexto-inicial/:userUuid/:lineUuid", async (req, res) => {
  const { userUuid, lineUuid } = req.params;

  if (!userUuid || !lineUuid) {
    return res.status(400).json({ error: "Faltan userUuid o lineUuid" });
  }

  try {
    const datos = await llamarWebhookContexto({ userUuid, lineUuid });
    return res.json(datos);
  } catch (error) {
    console.error("❌ Error en /api/contexto-inicial:", error);
    return res.status(500).json({ error: "No se pudo obtener contexto" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT} en 0.0.0.0`);
  console.log(`🌐 Panel de gestión configurado en: ${process.env.PANEL_GESTION_URL || 'NO CONFIGURADO'}`);
  console.log(`📧 SMS configurado: ${process.env.SMS_ARENA_KEY ? 'SÍ' : 'NO'}`);
  console.log(`🤖 OpenAI configurado: ${process.env.OPENAI_API_KEY ? 'SÍ' : 'NO'}`);
});
