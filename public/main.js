const messagesDiv = document.getElementById('messages');
const input = document.getElementById('messageInput');

function addMessage(text, sender) {
  const msg = document.createElement('div');
  msg.className = 'message ' + sender;
  msg.innerText = text;
  messagesDiv.appendChild(msg);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
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
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  addMessage(text, 'user');
  input.value = '';

  // Simula que está escribiendo
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
    typingBubble.remove(); // borra "Escribiendo..."
    addMessage(data.reply, 'assistant');
  } catch (err) {
    typingBubble.remove();
    addMessage("Error al conectar con el servidor.", "assistant");
  }
}

restoreChat();
