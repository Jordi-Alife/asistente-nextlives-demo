const messagesDiv = document.getElementById('messages');
const input = document.getElementById('messageInput');
const fileInput = document.getElementById('fileInput');

// 🟢 Generar o recuperar ID único del usuario
function getUserId() {
  let id = localStorage.getItem("userId");
  if (!id) {
    id = Math.random().toString(36).substring(2, 10); // ej: ab45cd89
    localStorage.setItem("userId", id);
  }
  return id;
}

const userId = getUserId();

// 🟡 WebSocket
const ws = new WebSocket(`wss://${window.location.host}`);
ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ userId }));
});

// Recibir mensajes desde Slack en tiempo real
ws.addEventListener("message", (event) => {
  try {
    const data = JSON.parse(event.data);
    if (data.sender === "assistant") {
      addMessage(data.text, "assistant");
    }
  } catch (err) {
    console.error("Error recibiendo mensaje por WebSocket:", err);
  }
});

// Añadir mensajes al chat
function addMessage(text, sender) {
  const msg = document.createElement("div");
  msg.className = "message " + sender;
  msg.innerText = text;
  messagesDiv.appendChild(msg);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  saveChat();
}

// Añadir imagen al chat
function addImageMessage(fileURL, sender) {
  const msg = document.createElement("div");
  msg.className = "message " + sender;
  const img = document.createElement("img");
  img.src = fileURL;
  img.alt = "Imagen enviada";
  img.style.maxWidth = "100%";
  img.style.borderRadius = "12px";
  msg.appendChild(img);
  messagesDiv.appendChild(msg);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  saveChat();
}

// Guardar y restaurar chat
function saveChat() {
  localStorage.setItem("chatMessages", messagesDiv.innerHTML);
}

function restoreChat() {
  const saved = localStorage.getItem("chatMessages");
  if (saved) {
    messagesDiv.innerHTML = saved;
  } else {
    setTimeout(() => {
      addMessage("Hola, ¿cómo puedo ayudarte?", "assistant");
    }, 500);
  }
}

// Enviar mensaje al backend
async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  addMessage(text, "user");
  input.value = "";

  const typingBubble = document.createElement("div");
  typingBubble.className = "message assistant";
  typingBubble.innerText = "Escribiendo...";
  messagesDiv.appendChild(typingBubble);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    typingBubble.remove();
    addMessage(data.reply, "assistant");
  } catch (err) {
    typingBubble.remove();
    addMessage("Error al conectar con el servidor.", "assistant");
  }
}

// Enviar imagen
fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  const userURL = URL.createObjectURL(file);
  addImageMessage(userURL, "user");

  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    const result = await res.json();
    addMessage(result.reply || "Imagen enviada correctamente.", "assistant");
  } catch (err) {
    addMessage("Hubo un problema al subir la imagen.", "assistant");
  }

  fileInput.value = "";
});

restoreChat();
