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

  const typingBubble = document.createElement('div');
  typingBubble.className = 'message assistant';
  typingBubble.innerText = 'Escribiendo...';
  messagesDiv.appendChild(typingBubble);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  const systemMessage = `
Eres un asistente virtual que da soporte sobre el canal digital de homenaje ofrecido por funerarias a través de NextLives. Tu tono es claro, empático y profesional.

Responde siempre de forma específica basándote en esta información:

- El "canal digital" es una web conmemorativa que contiene datos del funeral, fotos, videos, mensajes y recuerdos.
- Para publicar mensajes (texto, audio o dibujo) el usuario debe estar registrado o iniciar sesión.
- La zona familiar es privada, visible solo para quienes tienen permiso. Permite subir fotos, vídeos (vía enlace), textos largos y recibir comentarios o likes.
- El canal no ofrece streaming en directo, pero sí se puede ver el contenido en Smart TV.
- Para cambiar la foto del difunto se necesita permiso y acceso a la zona familiar.
- Se pueden comprar flores desde el canal.
- Todo el canal usa la imagen y marca de la funeraria, no se menciona NextLives.
- Se puede cambiar el idioma desde la web.

Tu objetivo es guiar al usuario paso a paso de forma sencilla, sin usar definiciones genéricas. Si no tienes la respuesta, sugiere contactar con el soporte de la funeraria correspondiente.
`;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, system: systemMessage })
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
