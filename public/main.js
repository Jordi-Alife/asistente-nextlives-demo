const messagesDiv = document.getElementById('messages');
const input = document.getElementById('messageInput');
const fileInput = document.getElementById('fileInput');

// Obtener o generar ID de usuario y guardarlo
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = Math.random().toString(36).substring(2, 10);
  localStorage.setItem('userId', userId);
}

// Añadir mensajes al chat
function addMessage(text, sender) {
  const msg = document.createElement('div');
  msg.className = 'message ' + sender;
  msg.innerText = text;
  messagesDiv.appendChild(msg);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  saveChat();
}

// Añadir imagen al chat
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
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  saveChat();
}

// Guardar conversación
function saveChat() {
  localStorage.setItem('chatMessages', messagesDiv.innerHTML);
}

// Restaurar conversación
function restoreChat() {
  const saved = localStorage.getItem('chatMessages');
  if (saved) {
    messagesDiv.innerHTML = saved;
  } else {
    setTimeout(() => {
      addMessage("Hola, ¿cómo puedo ayudarte?", "assistant");
    }, 500);
  }
}

// Enviar mensaje
async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  addMessage(text, 'user');
  input.value = '';

  const typing = document.createElement('div');
  typing.className = 'message assistant';
  typing.innerText = 'Escribiendo...';
  messagesDiv.appendChild(typing);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, userId })
    });

    const data = await res.json();
    typing.remove();
    addMessage(data.reply, 'assistant');
  } catch (err) {
    typing.remove();
    addMessage("Error al conectar con el servidor.", "assistant");
  }
}

// Enviar imagen
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  const localURL = URL.createObjectURL(file);
  addImageMessage(localURL, 'user');

  try {
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const result = await res.json();
    addMessage(result.reply || "Imagen enviada correctamente.", "assistant");
  } catch (err) {
    addMessage("Hubo un problema al subir la imagen.", "assistant");
  }

  fileInput.value = '';
});

// Consultar respuestas desde Slack
async function pollSlackResponses() {
  try {
    const res = await fetch(`/api/poll/${userId}`);
    const data = await res.json();
    if (data.mensajes && data.mensajes.length > 0) {
      data.mensajes.forEach(m => addMessage(m, 'assistant'));
    }
  } catch (err) {
    console.error("Error en polling:", err);
  }
}

// Lanzar polling cada 4 segundos
setInterval(pollSlackResponses, 4000);

restoreChat();
