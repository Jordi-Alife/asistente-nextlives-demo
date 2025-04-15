// Abrir/cerrar el chat al hacer clic en el botón de "Ayuda"
document.addEventListener('DOMContentLoaded', () => {
  const launchButton = document.getElementById('launch-chat');
  const chatWidget = document.getElementById('chat-widget');

  if (launchButton && chatWidget) {
    launchButton.addEventListener('click', () => {
      chatWidget.classList.add('open');
    });
  }

  const closeBtn = document.querySelector('.close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      chatWidget.classList.remove('open');
    });
  }
});

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

  // Animación escribiendo
  const typingBubble = document.createElement('div');
  typingBubble.className = 'message assistant';
  typingBubble.innerHTML = '<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>';
  messagesDiv.appendChild(typingBubble);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  // Idioma del navegador
  const idiomaNavegador = navigator.language || navigator.userLanguage || "es";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        lang: idiomaNavegador
      })
    });

    const data = await res.json();
    typingBubble.remove();
    addMessage(data.reply, 'assistant');
  } catch (err) {
    typingBubble.remove();
    addMessage("Error al conectar con el servidor.", "assistant");
  }
}

restoreChat();
