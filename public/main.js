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
  localStorage.setItem('chatMessages', messagesDiv.innerHTML);
}

function restoreChat() {
  const saved = localStorage.getItem('chatMessages');
  if (saved) {
    messagesDiv.innerHTML = saved;

    // ✅ Eliminar imágenes con blobs expirados (solo los temporales)
    const images = messagesDiv.querySelectorAll('img[data-is-image="true"]');
    images.forEach(img => {
      if (img.src.startsWith('blob:')) {
        img.parentElement.remove(); // elimina el mensaje si era imagen temporal
      }
    });

    // ✅ Eliminar mensajes vacíos
    const allMessages = messagesDiv.querySelectorAll('.message');
    allMessages.forEach(msg => {
      const isEmpty = !msg.textContent.trim() && msg.children.length === 0;
      if (isEmpty) msg.remove();
    });
  } else {
    setTimeout(() => {
      addMessage("Hola, ¿cómo puedo ayudarte?", "assistant");
    }, 500);
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
  const text = input.value.trim();
  if (!text) return;

  const userId = getUserId();
  addMessage(text, 'user');
  input.value = '';
  sendBtn.classList.remove('active');
  avisarEscribiendo("");

  const tempId = `typing-${Date.now()}`;
  addTypingBubble(tempId);

  const start = Date.now();
  try {
    const bodyData = {
      message: text,
      userId,
      userAgent: metadata.userAgent,
      pais: metadata.pais,
      historial: metadata.historial
    };

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyData)
    });

    const data = await res.json();
    const elapsed = Date.now() - start;
    const minDelay = 1500;
    const remaining = Math.max(0, minDelay - elapsed);

    setTimeout(() => {
      removeMessageByTempId(tempId);
      addMessage(data.reply, 'assistant');
    }, remaining);

  } catch (err) {
    removeMessageByTempId(tempId);
    addMessage("Error al conectar con el servidor.", "assistant");
  }
}

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
  const textos = [
    "¿Realmente quieres cerrar el chat? Esto borrará toda la conversación.",
    "Cancelar",
    "Cerrar el chat"
  ];
  let traducciones = textos;

  if (userId) {
    try {
      const res = await fetch(`/api/traducir-modal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, textos })
      });
      const data = await res.json();
      traducciones = data.traducciones || textos;
    } catch (error) {
      console.error("Error traduciendo modal:", error);
    }
  }

  document.getElementById('modalText').innerHTML = traducciones[0];
  document.getElementById('btnCancelar').innerText = traducciones[1];
  document.getElementById('btnConfirmar').innerText = traducciones[2];
  document.getElementById('modalConfirm').style.display = 'flex';
}

async function cerrarChatConfirmado() {
  const userId = getUserId();

  await notificarEvento("chat_cerrado");

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

  localStorage.removeItem('chatMessages');
  localStorage.setItem('chatEstado', 'cerrado');
  document.getElementById('chat-widget').style.display = 'none';
  document.getElementById('chat-toggle').style.display = 'flex';
  document.getElementById('scrollToBottomBtn').style.display = 'none';
  document.getElementById('modalConfirm').style.display = 'none'; // ✅ CIERRA MODAL EXPLÍCITAMENTE
}

function abrirChat() {
  window.location.reload();
}

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const userURL = URL.createObjectURL(file);
  const tempId = `img-${Date.now()}`;
  const tempMsg = document.createElement('div');
  tempMsg.className = 'message user';
  tempMsg.dataset.tempId = tempId;
  tempMsg.innerHTML = `<img src="${userURL}" alt="Imagen temporal" style="max-width: 100%; border-radius: 12px;" data-is-image="true" />`;
  messagesDiv.appendChild(tempMsg);
  scrollToBottom();

  const formData = new FormData();
  formData.append("file", file);
  formData.append("userId", getUserId());

  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const result = await res.json();

    // ✅ Reemplazar la imagen temporal por la imagen real desde el servidor
    tempMsg.innerHTML = `<img src="${result.imageUrl}" alt="Imagen enviada" style="max-width: 100%; border-radius: 12px;" data-is-image="true" />`;
    saveChat();
  } catch (err) {
    tempMsg.remove();
    addMessage("❌ Hubo un problema al subir la imagen.", "assistant");
  }

  fileInput.value = '';
});
async function checkPanelMessages() {
  const userId = getUserId();
  try {
    const res = await fetch(`/api/poll/${userId}`);
    const data = await res.json();
    if (data && Array.isArray(data.mensajes)) {
      data.mensajes.forEach((msg) => {
        if (!document.querySelector(`[data-panel-id="${msg.id}"]`)) {
          console.log("📨 Mensaje manual recibido:", msg);
          const messageDiv = document.createElement('div');
          messageDiv.className = 'message assistant';
          if (msg.manual) {
            messageDiv.classList.add('manual');
          }
          messageDiv.dataset.panelId = msg.id;

          // ✅ Mostrar como imagen si la URL es de tipo imagen
          if (/\.(jpeg|jpg|png|gif|webp)$/i.test(msg.mensaje)) {
            messageDiv.innerHTML = `<img src="${msg.mensaje}" alt="Imagen enviada" style="max-width: 100%; border-radius: 12px;" data-is-image="true" />`;
          } else {
            messageDiv.innerText = msg.mensaje;
          }

          messagesDiv.appendChild(messageDiv);
          scrollToBottom();
          saveChat();
        }
      });
    }
  } catch (error) {
    console.error("Error al obtener mensajes manuales:", error);
  }
}
setInterval(checkPanelMessages, 5000);
restoreChat();
getUserId();

const scrollBtn = document.getElementById('scrollToBottomBtn');
messagesDiv.addEventListener('scroll', () => {
  const threshold = 150;
  const isNearBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight < threshold;
  scrollBtn.style.display = isNearBottom ? 'none' : 'flex';
});

input.addEventListener('input', () => {
  avisarEscribiendo(input.value);
  if (input.value.trim() !== "") {
    sendBtn.classList.add('active');
  } else {
    sendBtn.classList.remove('active');
  }
});

input.addEventListener('focus', () => {
  setTimeout(() => scrollToBottom(), 300);
});

document.addEventListener('DOMContentLoaded', () => {
  const btnConfirmar = document.getElementById('btnConfirmar');
  if (btnConfirmar) {
    btnConfirmar.addEventListener('click', cerrarChatConfirmado);
  }
});
