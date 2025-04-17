const messagesDiv = document.getElementById('messages');
const input = document.getElementById('messageInput');
const fileInput = document.getElementById('fileInput');

// Obtener o crear ID de usuario
function getUserId() {
  let id = localStorage.getItem("userId");
  if (!id) {
    id = Math.random().toString(36).substring(2, 10); // 8 caracteres
    localStorage.setItem("userId", id);
  }
  const idDisplay = document.getElementById("userIdDisplay");
  if (idDisplay) idDisplay.textContent = `ID de usuario: ${id}`;
  return id;
}

// Mostrar un mensaje en el chat
function addMessage(text, sender) {
  const msg = document.createElement('div');
  msg.className = 'message ' + sender;
  msg.innerText = text;
  messagesDiv.appendChild(msg);
  scrollToBottom();
  saveChat();
}

// Mostrar una imagen en el chat
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

// Guardar historial
function saveChat() {
  localStorage.setItem('chatMessages', messagesDiv.innerHTML);
}

// Restaurar historial
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

// Scroll hasta abajo
function scrollToBottom() {
  setTimeout(() => {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }, 100);
}

// Enviar mensaje
async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  const userId = getUserId();
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

// Subir imagen
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("userId", getUserId());

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

// Revisar mensajes desde Slack
async function checkSlackMessages() {
  const userId = getUserId();

  try {
    const res = await fetch(`/api/poll/${userId}`);
    const data = await res.json();

    if (data && Array.isArray(data.mensajes)) {
      data.mensajes.forEach((msg) => {
        console.log("📨 Mensaje desde Slack recibido en el navegador:", msg);
        addMessage(msg, "assistant");
      });
    }
  } catch (error) {
    console.error("Error al obtener mensajes desde Slack:", error);
  }
}

// Ajuste para teclado móvil
window.addEventListener("resize", () => {
  scrollToBottom();
});

// Ejecutar
setInterval(checkSlackMessages, 5000);
getUserId();
restoreChat();