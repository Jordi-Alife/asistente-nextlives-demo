function sendMessage() {
  const input = document.getElementById('input');
  const messages = document.getElementById('chat-messages');
  const text = input.value.trim();
  if (!text) return;

  const userMessage = document.createElement('div');
  userMessage.textContent = 'Tú: ' + text;
  messages.appendChild(userMessage);

  input.value = '';

  fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: text }),
  })
  .then(res => res.json())
  .then(data => {
    const assistantMessage = document.createElement('div');
    assistantMessage.textContent = 'Asistente: ' + data.reply;
    messages.appendChild(assistantMessage);
  })
  .catch(err => {
    const error = document.createElement('div');
    error.textContent = 'Error al contactar con el asistente.';
    messages.appendChild(error);
  });
}
