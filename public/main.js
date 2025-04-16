const messagesDiv = document.getElementById('messages');
const input = document.getElementById('messageInput');
const fileInput = document.getElementById('fileInput');

// Obtener o generar un ID único por usuario
function getUserId() {
  let id = localStorage.getItem("userId");
  if (!id) {
    id = Math.random().toString(36).substring(2, 10); // 8 caracteres aleatorios
    localStorage.setItem("userId", id);
  }
  return id;
}

const userId = getUserId(); // Obtenerlo una sola vez

// Añadir mensaje de texto
function addMessage(text, sender) {
  const msg = document.createElement('div');
  msg.className = 'message ' + sender;
  msg.innerText = text;
  messagesDiv.appendChild(msg);
  scrollToBottom();
  saveChat();
}

// Añadir mensaje de imagen
function addImageMessage(fileURL, sender) {
  const msg = document.createElement('div');
  msg.className = 'message ' + sender;
  const img = document.createElement('img');
  img.src = fileURL;
  img.alt = 'Imagen enviada';
  img.style.maxWidth = '100%';
  img.style.borderRadius = '12px';
  msg.appendChild(img);
  messagesDiv.appendChild(msg);
  scrollToBottom();
  saveChat();
}

// Guardar historial en localStorage
function saveChat() {
  localStorage.setItem('chatMessages', messagesDiv.innerHTML);
}

// Restaurar historial del chat
function restoreChat() {
  const saved = localStorage.getItem('chatMessages');
  if (saved) {
    messagesDiv.innerHTML = saved;
  } else {
    setTimeout(() => {
      addMessage("Hola, ¿cómo puedo ayudarte?", "assistant");
    }, 500);
  }
  scrollToBottom();
}

// Hacer scroll hacia el final del chat
function scrollToBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Enviar mensaje al backend
async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  addMessage(text, 'user');
  input.value = '';

  const typingBubble = document.createElement('div');
  typingBubble.className = 'message assistant';
  typingBubble.innerText = 'Escribiendo...';
  messagesDiv.appendChild(typingBubble);
  scrollToBottom();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, userId })
    });
    const data = await res.json();
    typingBubble.remove();
    addMessage(data.reply, 'assistant');
  } catch (err) {
    typingBubble.remove();
    addMessage("Error al conectar con el servidor.", "assistant");
  }
}

// Subida de imagen
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  const userURL = URL.createObjectURL(file);
  addImageMessage(userURL, 'user');

  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const result = await res.json();
    addMessage(result.reply || "Imagen enviada correctamente.", "assistant");
  } catch (err) {
    addMessage("Hubo un problema al subir la imagen.", "assistant");
  }

  fileInput.value = '';
});

// Recibir mensajes desde Slack
function startSlackPolling() {
  setInterval(async () => {
    try {
      const res = await fetch(`/api/poll/${userId}`);
      const data = await res.json();
      if (data.mensajes && data.mensajes.length > 0) {
        data.mensajes.forEach(msg => addMessage(msg, 'assistant'));
      }
    } catch (err) {
      console.error("Error al recibir mensajes desde Slack:", err);
    }
  }, 3000); // cada 3 segundos
}

// Iniciar
restoreChat();
startSlackPolling();
