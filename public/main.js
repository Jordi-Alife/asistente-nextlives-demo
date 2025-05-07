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

async function cerrarChatConfirmado() {
  messagesDiv.innerHTML = '';
  const userId = getUserId();
  try {
    await fetch("/api/evento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, evento: "chat_cerrado" })
    });
    console.log("✅ Notificado al backend: chat cerrado por usuario.");
  } catch (error) {
    console.error("❌ Error notificando evento chat_cerrado:", error);
  }
  localStorage.setItem('chatEstado', 'cerrado');
  document.getElementById('chat-widget').style.display = 'none';
  document.getElementById('chat-toggle').style.display = 'flex';
  document.getElementById('scrollToBottomBtn').style.display = 'none';
  ocultarModal();
}
