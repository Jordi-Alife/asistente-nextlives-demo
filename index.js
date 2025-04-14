const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/chat', (req, res) => {
  const userMessage = req.body.message;
  const response = `Recibido: "${userMessage}". Esta es una respuesta simulada del asistente.`;
  res.json({ reply: response });
});

app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});
