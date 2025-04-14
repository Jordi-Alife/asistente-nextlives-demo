const messages = document.getElementById("messages");
const input = document.getElementById("user-input");

function mostrarMensaje(texto, clase) {
  const div = document.createElement("div");
  div.textContent = texto;
  div.className = clase;
  messages.appendChild(div);
}

async function enviar() {
  const mensaje = input.value;
  if (!mensaje.trim()) return;

  mostrarMensaje("Tú: " + mensaje, "usuario");
  input.value = "";

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: mensaje })
  });

  const data = await res.json();
  mostrarMensaje("Asistente: " + data.reply, "asistente");
}
