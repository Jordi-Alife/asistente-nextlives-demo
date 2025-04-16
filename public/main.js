const messagesDiv = document.getElementById('messages');
const input = document.getElementById('messageInput');
const fileInput = document.getElementById('fileInput');

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

// Guardar en localStorage
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
    }, 300);
  }
}

// Enviar texto al backend
async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, 'user');
  input.value = '';

  // Añadir "escribiendo..." como asistente
  const typingBubble = document.createElement('div');
  typingBubble.className = 'message assistant';
  typingBubble.innerText = 'Escribiendo...';
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
    addMessage(data.reply, 'assistant');
  } catch (err) {
    typingBubble.remove();
    addMessage("Error al conectar con el servidor.", "assistant");
  }
}

// Adjuntar imagen
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const userURL = URL.createObjectURL(file);
  addImageMessage(userURL, 'user');

  const formData = new FormData();
  formData.append("imagen", file);

  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const result = await res.json();
    if (result.imageUrl) {
      addImageMessage(result.imageUrl, 'assistant');
    } else {
      addMessage("Imagen enviada correctamente.", "assistant");
    }
  } catch (err) {
    addMessage("Hubo un problema al subir la imagen.", "assistant");
  }

  fileInput.value = ''; // Reset del input
});

restoreChat();
