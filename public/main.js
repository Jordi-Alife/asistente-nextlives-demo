async function sendMessage() {
  const input = document.getElementById('input');
  const text = input.value.trim();
  if (!text) return;

  appendMessage('user', text);
  input.value = '';

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text })
  });

  const data = await response.json();
  appendMessage('assistant', data.reply);
}

function appendMessage(role, content) {
  const chat = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'message ' + role;
  msg.textContent = content;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
}