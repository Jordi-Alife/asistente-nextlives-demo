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

function addMessage(text, sender, msgId = null) {
  if (!text.trim()) return null;
  if (msgId && document.querySelector(`[data-msg-id="${msgId}"]`)) return null; // evitar duplicados

  const msg = document.createElement('div');
  msg.className = 'message ' + sender;
  if (msgId) msg.dataset.msgId = msgId;
  msg.innerText = text;
  messagesDiv.appendChild(msg);
  scrollToBottom();
  saveChat();
  return msgId || null;
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
  scrollToBottom(false);
}

function scrollToBottom(smooth = true) {
  messagesDiv.scrollTo({
    top: messagesDiv.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto'
  });
}

async function pollManualMessages() {
  const userId = getUserId();
  try {
    const res = await fetch(`/api/conversaciones/${userId}`);
    const data = await res.json();
    if (Array.isArray(data)) {
      data.forEach(msg => {
        if (msg.manual) {
          addMessage(msg.message, 'assistant', msg.lastInteraction);
        }
      });
    }
  } catch (err) {
    console.error("Error en polling de mensajes manuales:", err);
  }
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  const userId = getUserId();
  addMessage(text, 'user');
  input.value = '';
  sendBtn.classList.remove('active');
  avisarEscribiendo("");

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
    addMessage(data.reply, 'assistant');

  } catch (err) {
    addMessage("Error al conectar con el servidor.", "assistant");
  }
}

function avisarEscribiendo(texto) {
  const userId = getUserId();
  fetch("/api/escribiendo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, texto })
  });
}

function cerrarChatConfirmado() {
  document.getElementById('chat-widget').style.display = 'none';
  document.getElementById('chat-toggle').style.display = 'flex';
  document.getElementById('scrollToBottomBtn').style.display = 'none';
  localStorage.removeItem('chatMessages');
  messagesDiv.innerHTML = '';
  notificarEvento("chat_cerrado");
}

function abrirChat() {
  window.location.reload();
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

restoreChat();
getUserId();
setInterval(pollManualMessages, 5000);

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
