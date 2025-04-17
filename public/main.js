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

function addMessage(text, sender) {
  const msg = document.createElement('div');
  msg.className = 'message ' + sender;
  msg.innerText = text;
  messagesDiv.appendChild(msg);
  scrollToBottom();
  saveChat();
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

function saveChat() {
  localStorage.setItem('chatMessages', messagesDiv.innerHTML);
}

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

function scrollToBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

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
        console.log("📨 Mensaje desde Slack recibido en el navegador:", msg);
        addMessage(msg, "assistant");
      });
    }
  } catch (error) {
    console.error("Error al obtener mensajes desde Slack:", error);
  }
}

setInterval(checkSlackMessages, 5000);
restoreChat();
getUserId(); // Asegura que el ID y su visualización estén listos al cargar