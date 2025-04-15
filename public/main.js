async function sendMessage() {
  const input = document.getElementById('input');
  const message = input.value;

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message })
  });

  const data = await response.json();

  // Mostrar el mensaje del asistente
  const messagesContainer = document.getElementById('chat-messages');
  const assistantMsg = document.createElement('div');
  assistantMsg.className = 'message assistant';
  assistantMsg.innerText = data.reply;
  messagesContainer.appendChild(assistantMsg);

  input.value = ''; // limpia el campo
}
