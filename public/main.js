document.getElementById("chat-form").addEventListener("submit", async function (e) {
  e.preventDefault();

  const userInput = document.getElementById("user-input").value;
  const respuestaDiv = document.getElementById("respuesta");
  respuestaDiv.textContent = "Cargando...";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: userInput })
    });

    const data = await response.json();

    if (data.reply) {
      respuestaDiv.textContent = data.reply;
    } else {
      respuestaDiv.textContent = "Respuesta no válida.";
    }

  } catch (err) {
    respuestaDiv.textContent = "Error al conectar con el servidor.";
    console.error(err);
  }
});
