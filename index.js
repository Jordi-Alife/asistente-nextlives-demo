const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ruta POST para el chat
app.post('/api/chat', async (req, res) => {
  const userMessage = req.body.message;

  // Simula una respuesta
  const respuesta = `Recibido: "${userMessage}". Esta es una respuesta de prueba.`;

  res.json({ reply: respuesta });
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});
