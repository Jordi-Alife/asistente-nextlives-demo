const messagesDiv = document.getElementById('messages');
const input = document.getElementById('messageInput');
const fileInput = document.getElementById('fileInput');

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

function addMessage(text, sender, tempId = null) {
  if (!text.trim()) return null; // Evita burbujas vacías

  const msg = document.createElement('div');
  msg.className = 'message ' + sender;
  msg.innerText = text;
  if (tempId) msg.dataset.tempId = tempId;

  messagesDiv.appendChild(msg);
  scrollToBottom();
  saveChat();
  return tempId || null;
}

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

    // Eliminar burbujas vacías
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

  const tempId = `typing-${Date.now()}`;
  addMessage("Escribiendo...", "assistant", tempId);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, userId })
    });

    const data = await res.json();
    removeMessageByTempId(tempId);
    addMessage(data.reply, 'assistant');
  } catch (err) {
    removeMessageByTempId(tempId);
    addMessage("Error al conectar con el servidor.", "assistant");
  }
}

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

async function checkSlackMessages() {
  const userId = getUserId();

  try {
    const res = await fetch(`/api/poll/${userId}`);
    const data = await res.json();

    if (data && Array.isArray(data.mensajes)) {
      data.mensajes.forEach((msg) => {
        console.log("📨 Mensaje desde Slack recibido:", msg);
        addMessage(msg, "assistant");
        saveChat();
      });
    }
  } catch (error) {
    console.error("Error al obtener mensajes desde Slack:", error);
  }
}

setInterval(checkSlackMessages, 5000);
restoreChat();
getUserId();
