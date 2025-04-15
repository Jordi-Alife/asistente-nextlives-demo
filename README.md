# Asistente IA Canal Digital (NextLives Demo)

Este repositorio contiene un prototipo funcional de asistente conversacional basado en OpenAI GPT-4, diseñado para integrarse en el Canal Digital de NextLives.

## Tecnologías
- Backend: Node.js + Express
- Frontend: HTML + JS vanilla
- IA: OpenAI GPT-4
- Despliegue: Railway

## Archivos importantes
- `index.js`: Servidor Express
- `public/main.js`: Lógica del frontend del chat
- `asistente-publico.zip`: Versión descargable para prueba sin despliegue
- `.env` (no incluido): Se debe definir `OPENAI_API_KEY`

## Cómo desplegar en Railway

1. Conecta el repo en Railway
2. Añade la variable `OPENAI_API_KEY` desde Settings > Variables
3. ¡Listo! Prueba tu URL pública (por ejemplo: `https://web-production-xxxx.up.railway.app`)
