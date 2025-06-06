const messagesDiv = document.getElementById('messages');
const input = document.getElementById('messageInput');
const fileInput = document.getElementById('fileInput');
const sendBtn = document.querySelector('.send-button');

function getUserId() {
  let id = localStorage.getItem("userId");
  if (!id) {
    id = Math.random().toString(36).substring(2, 10);
    localStorage.setItem("userId", id);
  }
  const display = document.getElementById("userIdDisplay");
  if (display) display.textContent = `ID de usuario: ${id}`;
  return id;
}

const metadata = {
  userAgent: navigator.userAgent,
  historial: JSON.parse(localStorage.getItem("historialPaginas") || "[]"),
  pais: null
};
metadata.historial.push(window.location.href);
localStorage.setItem("historialPaginas", JSON.stringify(metadata.historial));

fetch("https://ipapi.co/json")
  .then(res => res.json())
  .then(data => {
    metadata.pais = data.country_name;
    console.log("🌍 País detectado:", metadata.pais);
  })
  .catch(() => {
    metadata.pais = "Desconocido";
  });

function addMessage(text, sender, tempId = null) {
  if (!text.trim()) return null;

  // ✅ Detectar si es una URL de imagen
  const isImage = /\.(jpeg|jpg|png|gif|webp)$/i.test(text.trim());
  if (isImage) {
    addImageMessage(text.trim(), sender);
    return tempId || null;
  }

  const msg = document.createElement('div');
  msg.className = 'message ' + sender;
  if (tempId) msg.dataset.tempId = tempId;
  msg.innerText = text;
  messagesDiv.appendChild(msg);

  // ✅ Limitar a los últimos 50 mensajes visibles
  const visibles = messagesDiv.querySelectorAll('.message');
  if (visibles.length > 50) {
    for (let i = 0; i < visibles.length - 50; i++) {
      visibles[i].remove();
    }
  }

  scrollToBottom();
  saveChat();
  return tempId || null;
}

function addTypingBubble(tempId) {
  const msg = document.createElement('div');
  msg.className = 'message assistant';
  msg.dataset.tempId = tempId;
  msg.innerHTML = `
    <div class="typing-indicator">
      <span></span><span></span><span></span>
    </div>
  `;
  messagesDiv.appendChild(msg);
  scrollToBottom();
}

function addImageMessage(fileURL, sender) {
  const msg = document.createElement('div');
  msg.className = 'message ' + sender;

  // ✅ Añadimos el atributo data-is-image para detectar en restoreChat()
  msg.innerHTML = `<img src="${fileURL}" alt="Imagen enviada" style="max-width: 100%; border-radius: 12px;" data-is-image="true" />`;

  messagesDiv.appendChild(msg);
  scrollToBottom();
  saveChat();
}

function removeMessageByTempId(tempId) {
  if (!tempId) return;
  const temp = document.querySelector(`[data-temp-id="${tempId}"]`);
  if (temp) temp.remove();
}

function saveChat() {
  const allMessages = Array.from(messagesDiv.children).filter((el) =>
    el.classList.contains("message")
  );

  const limitados = allMessages.slice(-50); // Solo los últimos 50
  const tempContainer = document.createElement("div");
  limitados.forEach((el) => tempContainer.appendChild(el.cloneNode(true)));

  localStorage.setItem("chatMessages", tempContainer.innerHTML);
}

function restoreChat() {
  const saved = localStorage.getItem('chatMessages');
  if (saved) {
    const tempContainer = document.createElement("div");
    tempContainer.innerHTML = saved;

    const mensajes = Array.from(tempContainer.children).filter((el) =>
      el.classList.contains("message")
    );

    // ✅ Limitar a los últimos 50
    if (mensajes.length > 50) {
      mensajes.splice(0, mensajes.length - 50);
    }

    messagesDiv.innerHTML = "";
    mensajes.forEach((el) => messagesDiv.appendChild(el));

    // ✅ Eliminar imágenes con blobs expirados
    const images = messagesDiv.querySelectorAll('img[data-is-image="true"]');
    images.forEach((img) => {
      if (img.src.startsWith("blob:")) {
        img.parentElement.remove();
      }
    });

    // ✅ Eliminar mensajes vacíos
    const allMessages = messagesDiv.querySelectorAll(".message");
    allMessages.forEach((msg) => {
      const isEmpty = !msg.textContent.trim() && msg.children.length === 0;
      if (isEmpty) msg.remove();
    });
  }
  scrollToBottom(false);
}
function scrollToBottom(smooth = true) {
  messagesDiv.scrollTo({
    top: messagesDiv.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto'
  });
}

async function sendMessage() {
  // ⛔ Esperar a que window.chatSystem esté listo
  if (!window.chatSystem?.initialized) {
    console.warn("⏳ Esperando datos de chatSystem...");
    setTimeout(sendMessage, 200); // Reintenta en 200ms
    return;
  }

  const text = input.value.trim();
  const userId = getUserId();

  // ⛔ Si no hay texto ni imagen, no hacemos nada
  if (!text && !imagenSeleccionada) return;

  // ✅ Mostrar el mensaje del usuario si hay texto
  if (text) {
    addMessage(text, 'user');
    input.value = '';
    sendBtn.classList.remove('active');
    avisarEscribiendo("");
  }

  // ✅ Si hay imagen pendiente de enviar, la subimos ahora
  if (imagenSeleccionada) {
    const tempId = `img-${Date.now()}`;
    const userURL = URL.createObjectURL(imagenSeleccionada);
    const tempMsg = document.createElement('div');
    tempMsg.className = 'message user';
    tempMsg.dataset.tempId = tempId;
    tempMsg.innerHTML = `<img src="${userURL}" alt="Imagen temporal" style="max-width: 100%; border-radius: 12px;" data-is-image="true" />`;
    messagesDiv.appendChild(tempMsg);
    scrollToBottom();

    const formData = new FormData();
    formData.append("file", imagenSeleccionada);
    formData.append("userId", userId);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData
      });
      const result = await res.json();
      tempMsg.innerHTML = `<img src="${result.imageUrl}" alt="Imagen enviada" style="max-width: 100%; border-radius: 12px;" data-is-image="true" />`;
      saveChat();
    } catch (err) {
      tempMsg.remove();
      addMessage("❌ Hubo un problema al subir la imagen.", "assistant");
    }

    // ✅ Limpiar
    imagenSeleccionada = null;
    const preview = document.getElementById("imagePreview");
    if (preview) preview.remove();
    fileInput.value = '';
  }

  // ✅ Si hay texto, enviar al backend
if (text) {
  const tempId = `typing-${Date.now()}`;
  addTypingBubble(tempId);

  const userUuid = window.chatSystem?.currentUser || null;
  const lineUuid = window.chatSystem?.currentLine || null;
  const languageFromChatSystem = window.chatSystem?.language || null;

  const datosContexto = {
  nombre: window.chatSystem?.nombre || null,
  userUuid: window.chatSystem?.currentUser || null,
  lineUuid: window.chatSystem?.currentLine || null,
  language: window.chatSystem?.language || null
};

console.log("📦 datosContexto enviados a GPT:", datosContexto);

const bodyData = {
  message: text,
  userId,
  userAgent: metadata.userAgent,
  pais: metadata.pais,
  historial: metadata.historial,
  userUuid: userUuid || null,
  lineUuid: lineUuid || null,
  language: languageFromChatSystem || null,
  datosContexto // ✅ Añadido aquí
};

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyData)
    });

    const data = await res.json();
    const delay = Math.max(0, 1500 - (Date.now() - parseInt(tempId.split('-')[1])));

    setTimeout(() => {
      removeMessageByTempId(tempId);
      if (data.reply?.trim()) addMessage(data.reply, 'assistant');
    }, delay);
      } catch (err) {
    removeMessageByTempId(tempId);
    addMessage("Error al conectar con el servidor.", "assistant");
  }
} // <- ESTE cierre es el que te faltaba
} // <- Este cierra la función sendMessage

function avisarEscribiendo(texto) {
  const userId = getUserId();
  if (!userId) return;
  fetch("/api/escribiendo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, texto })
  });
}

async function notificarEvento(tipo) {
  const userId = getUserId();
  try {
    await fetch("/api/evento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, tipo }),
    });
    console.log(`✅ Evento "${tipo}" notificado para ${userId}`);
  } catch (err) {
    console.error(`❌ Error notificando evento "${tipo}"`, err);
  }
}

async function mostrarModal() {
  const userId = getUserId();

  // Idiomas pretraducidos (incluye catalán y euskera)
  const traduccionesModal = {
    es: [
      "¿Realmente quieres cerrar el chat? Esto borrará toda la conversación.",
      "Cancelar",
      "Cerrar el chat"
    ],
    en: [
      "Do you really want to close the chat? This will erase the entire conversation.",
      "Cancel",
      "Close chat"
    ],
    fr: [
      "Voulez-vous vraiment fermer le chat ? Cela effacera toute la conversation.",
      "Annuler",
      "Fermer le chat"
    ],
    it: [
      "Vuoi davvero chiudere la chat? Questo cancellerà tutta la conversazione.",
      "Annulla",
      "Chiudi chat"
    ],
    de: [
      "Möchten Sie den Chat wirklich schließen? Dadurch wird die gesamte Unterhaltung gelöscht.",
      "Abbrechen",
      "Chat schließen"
    ],
    ca: [
      "Realment vols tancar el xat? Això esborrarà tota la conversa.",
      "Cancel·lar",
      "Tancar el xat"
    ],
    eu: [
      "Benetan itxi nahi duzu txata? Honek elkarrizketa osoa ezabatuko du.",
      "Utzi",
      "Itxi txata"
    ]
  };

  let idioma = "es"; // fallback por defecto

  try {
    const res = await fetch(`/api/estado-conversacion/${userId}`);
    const data = await res.json();
    if (data.idioma) idioma = data.idioma.toLowerCase();
  } catch (err) {
    console.warn("❌ No se pudo obtener idioma de conversación. Se usará español.");
  }

  const textos = traduccionesModal[idioma] || traduccionesModal["es"];

  document.getElementById("modalText").innerHTML = textos[0];
  document.getElementById("btnCancelar").innerText = textos[1];
  document.getElementById("btnConfirmar").innerText = textos[2];
  document.getElementById("modalConfirm").style.display = 'flex';
}

async function cerrarChatConfirmado() {
  const userId = getUserId();

  await notificarEvento("chat_cerrado");

  // Notificar al padre que el chat se está cerrando
  closeChat();

  if (userId) {
    try {
      await fetch("/api/cerrar-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId })
      });
      console.log(`✅ Estado "cerrado" guardado para ${userId}`);
    } catch (err) {
      console.error("❌ Error al guardar estado cerrado:", err);
    }
  }

localStorage.setItem('chatEstado', 'cerrado');
document.getElementById('chat-widget').style.display = 'none';
document.getElementById('chat-toggle').style.display = 'flex';
document.getElementById('scrollToBottomBtn').style.display = 'none';
document.getElementById('modalConfirm').style.display = 'none'; // ✅ CIERRA MODAL EXPLÍCITAMENTE
}

function abrirChat() {
 // ✅ Limpiar mensajes viejos de localStorage (si existen)
localStorage.removeItem("chatMessages");
messagesDiv.innerHTML = "";

// ✅ Activar listener en tiempo real para recibir mensajes manuales
activarListenerRealtime();

  // ✅ Mostrar el chat
  document.getElementById('chat-widget').style.display = 'flex';
  document.getElementById('chat-toggle').style.display = 'none';
  document.getElementById('scrollToBottomBtn').style.display = 'none';
}

// ⏳ Esperar a que window.escucharMensajesUsuario esté disponible
function esperarListenerManual(callback, intentos = 0) {
  if (typeof window.escucharMensajesUsuario === "function") {
    callback();
  } else if (intentos < 20) {
    setTimeout(() => esperarListenerManual(callback, intentos + 1), 200);
  } else {
    console.warn("❌ No se definió window.escucharMensajesUsuario tras esperar.");
  }
}

esperarListenerManual(() => {
  const userId = getUserId();
  if (!userId) return;

  window.escucharMensajesUsuario(userId, (lista) => {
    const mensajesNuevos = lista.filter((msg) => {
      return msg.manual && msg.id && !document.querySelector(`[data-panel-id="${msg.id}"]`);
    });

    mensajesNuevos.forEach((msg) => {
      const contenido = msg.mensaje || msg.message || msg.original || "";
      if (!contenido) return;

      const messageDiv = document.createElement("div");
      messageDiv.className = "message assistant";
      messageDiv.dataset.panelId = msg.id;

      if (/\.(jpeg|jpg|png|gif|webp)$/i.test(contenido)) {
        messageDiv.innerHTML = `<img src="${contenido}" alt="Imagen enviada" style="max-width: 100%; border-radius: 12px;" data-is-image="true" />`;
      } else {
        messageDiv.innerText = contenido;
      }

      messagesDiv.appendChild(messageDiv);

      const todos = messagesDiv.querySelectorAll(".message");
      if (todos.length > 50) {
        for (let i = 0; i < todos.length - 50; i++) {
          todos[i].remove();
        }
      }

      scrollToBottom();
      saveChat();
    });
  });
});
let imagenSeleccionada = null;

fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  imagenSeleccionada = file;

  const anterior = document.getElementById("imagePreview");
  if (anterior) anterior.remove();

  const previewContainer = document.createElement("div");
  previewContainer.id = "imagePreview";
  previewContainer.style = "margin: 10px 12px; display: flex; gap: 10px; align-items: center;";

  const img = document.createElement("img");
  img.src = URL.createObjectURL(file);
  img.style = "max-height: 100px; border-radius: 8px; border: 1px solid #ccc;";
  previewContainer.appendChild(img);

  const quitarBtn = document.createElement("button");
  quitarBtn.textContent = "Quitar imagen";
  quitarBtn.style = "color: red; font-size: 14px; text-decoration: underline; background: none; border: none; cursor: pointer;";
  quitarBtn.onclick = () => {
    imagenSeleccionada = null;
    previewContainer.remove();
    fileInput.value = '';
    sendBtn.classList.remove('active'); // ✅ Desactivar botón si se elimina la imagen y no hay texto
  };

  previewContainer.appendChild(quitarBtn);

  document.getElementById("chat-widget").appendChild(previewContainer);

  // ✅ Activar botón de enviar si hay imagen cargada
  if (imagenSeleccionada || input.value.trim() !== "") {
    sendBtn.classList.add('active');
  }
});

const userIdRealtime = getUserId();
if (window.escucharMensajesUsuario && userIdRealtime) {
  window.escucharMensajesUsuario(userIdRealtime, (mensajes) => {
    mensajes.forEach((msg) => {
      if (msg.manual && msg.id && !document.querySelector(`[data-panel-id="${msg.id}"]`)) {

  const contenido = msg.mensaje || msg.message || msg.original || "";
  if (!contenido) return;

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  messageDiv.dataset.panelId = msg.id;

  if (/\.(jpeg|jpg|png|gif|webp)$/i.test(contenido)) {
    messageDiv.innerHTML = `<img src="${contenido}" alt="Imagen enviada" style="max-width: 100%; border-radius: 12px;" data-is-image="true" />`;
  } else {
    messageDiv.innerText = contenido;
  }

  messagesDiv.appendChild(messageDiv);

  const todos = messagesDiv.querySelectorAll('.message');
  if (todos.length > 50) {
    for (let i = 0; i < todos.length - 50; i++) {
      todos[i].remove();
    }
  }

  scrollToBottom();
  saveChat();
}
    });
  });
}

// ✅ Activar listener en tiempo real para recibir mensajes manuales
activarListenerRealtime();

// ✅ Si no hay mensajes en pantalla, pedir saludo inicial
if (messagesDiv.children.length === 0) {
  const userId = getUserId();

  fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "__saludo_inicial__",
      userId,
      userAgent: metadata.userAgent,
      pais: metadata.pais,
      historial: metadata.historial,
      userUuid: window.chatSystem?.currentUser || null,
      lineUuid: window.chatSystem?.currentLine || null,
      language: window.chatSystem?.language || "es"
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.reply) {
      addMessage(data.reply, 'assistant');
    }
  })
  .catch(err => console.error("❌ Error al obtener saludo inicial:", err));
}
getUserId();

const scrollBtn = document.getElementById('scrollToBottomBtn');
messagesDiv.addEventListener('scroll', () => {
  const threshold = 150;
  const isNearBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight < threshold;
  scrollBtn.style.display = isNearBottom ? 'none' : 'flex';
});

let blurActivo = false; // ✅ Marca si el teclado se ha cerrado

input.addEventListener('input', () => {
  avisarEscribiendo(input.value);
  if (input.value.trim() !== "" || imagenSeleccionada) {
    sendBtn.classList.add('active');
  } else {
    sendBtn.classList.remove('active');
  }
});

input.addEventListener('focus', () => {
  setTimeout(() => scrollToBottom(), 300);

  // ✅ Ajuste fino para iOS al volver a enfocar
  setTimeout(() => {
    input.scrollIntoView({ behavior: "smooth", block: "center" });

    // ✅ Si venimos de un blur (teclado cerrado), forzamos scroll superior para evitar hueco
    if (blurActivo) {
      window.scrollTo({ top: 0 });
      blurActivo = false;
    }
  }, 500);
});
input.addEventListener('blur', () => {
  blurActivo = true;
  setTimeout(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 200);
});

document.addEventListener('DOMContentLoaded', () => {
  notifyReadyToReceiveParams();

  const btnConfirmar = document.getElementById('btnConfirmar');
  if (btnConfirmar) {
    btnConfirmar.addEventListener('click', cerrarChatConfirmado);
  }

  // ✅ Detectar clic en el botón de reapertura del chat
  const chatToggle = document.getElementById('chat-toggle');
  if (chatToggle) {
    chatToggle.addEventListener('click', abrirChat);
  }
});

function minimizarChat() {
  localStorage.setItem('chatEstado', 'minimizado');

  minimizeChat();

  // Detiene el polling de mensajes si estaba activo
  if (intervaloMensajes) {
    clearInterval(intervaloMensajes);
    intervaloMensajes = null;
    console.log("⏹️ Polling detenido al minimizar");
  }
}

function ocultarModal() {
  document.getElementById('modalConfirm').style.display = 'none';
}

/**
 * =============================================
 * COMUNICACIÓN CON APLICACIÓN PADRE VÍA IFRAME
 * =============================================
 */

// Variables globales para almacenar los parámetros recibidos
window.chatSystem = {
  currentUser: null,
  currentLine: null,
  language: 'en',
  initialized: false
};

// Agregar el listener para recibir mensajes del padre
window.addEventListener('message', (event) => {
  // Por seguridad, podrías verificar el origen del mensaje
  // if (event.origin !== 'https://tu-dominio.com') return;

  // Verificar si el mensaje es del tipo esperado
  if (event.data && event.data.type === 'CHAT_PARAMS') {
    // Extraer los datos recibidos
    const { userUuid, lineUuid, language } = event.data.data;

    // Inicializar el chat con estos parámetros
    initializeChat(userUuid, lineUuid, language);
  }
});

/**
 * Función para inicializar el chat con los parámetros recibidos
 * @param {string} userUuid - UUID del usuario
 * @param {string} lineUuid - UUID de la línea
 * @param {string} language - Idioma preferido del usuario
 */
function initializeChat(userUuid, lineUuid, language = 'en') {
  console.log('Inicializando chat con:', { userUuid, lineUuid, language });

  // ✅ Configurar correctamente los datos en window.chatSystem
  window.chatSystem = {
    currentUser: userUuid,
    currentLine: lineUuid,
    language: language,
    initialized: true
  };

  // ✅ Mostrar el ID de usuario en la interfaz
  const userInfoElement = document.getElementById('userIdDisplay');
  if (userInfoElement) {
    userInfoElement.textContent = `Usuario: ${getUserId()}`;
  }
  if (userInfoElement) {
    userInfoElement.textContent = `Usuario: ${getUserId()}`;
  }

  // 🔁 ACTIVAR LISTENER DE MENSAJES MANUALES DESDE PANEL
  if (window.chatSystem?.currentUser) {
    const userId = window.chatSystem.currentUser;

    esperarFirestore(() => {
  window.escucharMensajesUsuario = (callback) => {
    const mensajesRef = window.firestore.collection(window.firestore.db, 'conversaciones', userId, 'mensajes');
    const q = window.firestore.query(mensajesRef, window.firestore.where("manual", "==", true));

    return window.firestore.onSnapshot(q, (snapshot) => {
      console.log("🔥 Snapshot recibido:", snapshot.size);
      console.log("📦 Cambios detectados:", snapshot.docChanges().map(c => c.doc.data()));

      const nuevosMensajes = snapshot.docChanges()
        .filter(change => change.type === "added")
        .map(change => change.doc.data());

      if (nuevosMensajes.length > 0) {
        callback(nuevosMensajes);
      }
    });
  };

  console.log("✅ window.escucharMensajesUsuario definido");

  if (!window._listenerManualActivo) {
    window._listenerManualActivo = true;

    window.escucharMensajesUsuario((mensajes) => {
      mensajes.forEach((msg) => {
        const texto = msg.mensaje || msg.message || msg.original;
        if (texto) mostrarMensaje(texto, 'agente');
      });
    });
  }
});

    if (!window._listenerManualActivo) {
      window._listenerManualActivo = true;

      window.escucharMensajesUsuario((mensajes) => {
        mensajes.forEach((msg) => {
          const texto = msg.mensaje || msg.message || msg.original;
          if (texto) mostrarMensaje(texto, 'agente');
        });
      });
    }
  }
}

/**
 * Notificar a la aplicación padre que el chat está listo para recibir parámetros
 */
function notifyReadyToReceiveParams() {
  notifyParentEvent('CHAT_READY', { ready: true });
}

/**
 * Función para cerrar el chat desde el iframe
 */
function closeChat() {
  // Oculta el chat visualmente, si está embedded en un iframe
  if (window.parent && window.parent !== window) {
    notifyParentEvent('CHAT_CLOSED', { reason: 'User closed chat' });
  } else {
    // Si no está en un iframe, simplemente ocultamos el widget
    document.getElementById('chat-widget').style.display = 'none';
    document.getElementById('chat-toggle').style.display = 'flex';
    document.getElementById('scrollToBottomBtn').style.display = 'none';
  }
}

/**
 * Función para minimizar el chat desde el iframe
 */
function minimizeChat() {
  if (window.parent && window.parent !== window) {
    notifyParentEvent('CHAT_MINIMIZED', { reason: 'User minimized chat' });
  } else {
    document.getElementById('chat-widget').style.display = 'none';
    document.getElementById('chat-toggle').style.display = 'flex';
    document.getElementById('scrollToBottomBtn').style.display = 'none';
  }
}

/**
 * Función para notificar eventos al padre
 */
function notifyParentEvent(eventType, data = {}) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      type: eventType,
      data: data
    }, '*');
  }
}

// 👇 AÑADE AQUÍ ESTA FUNCIÓN
function activarListenerRealtime() {
  const userId = getUserId();
  if (!window.escucharMensajesUsuario || !userId) return;

  window.escucharMensajesUsuario(userId, (mensajes) => {
    mensajes.forEach((msg) => {
      if (
        msg.manual &&
        msg.id &&
        !document.querySelector(`[data-panel-id="${msg.id}"]`)
      ) {
        const contenido = msg.mensaje || msg.message || msg.original || "";
        if (!contenido) return;

        const div = document.createElement("div");
        div.className = "message assistant";
        div.dataset.panelId = msg.id;

        if (/\.(jpeg|jpg|png|gif|webp)$/i.test(contenido)) {
          div.innerHTML = `<img src="${contenido}" alt="Imagen enviada" style="max-width: 100%; border-radius: 12px;" data-is-image="true" />`;
        } else {
          div.innerText = contenido;
        }

        messagesDiv.appendChild(div);

        const todos = messagesDiv.querySelectorAll(".message");
        if (todos.length > 50) {
          for (let i = 0; i < todos.length - 50; i++) {
            todos[i].remove();
          }
        }

        scrollToBottom();
        saveChat();
      }
    });
  });
}

// 🟢 Este bloque ya lo tienes
document.addEventListener('DOMContentLoaded', () => {
  notifyReadyToReceiveParams();
});

// Cuando el DOM esté cargado, notificar que estamos listos
document.addEventListener('DOMContentLoaded', () => {
  notifyReadyToReceiveParams();
});

// También notificar cuando la ventana termine de cargar
window.addEventListener('load', () => {
  notifyReadyToReceiveParams();
});
