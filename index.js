// Detalle.jsx
import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

export default function Detalle() {
  const { userId } = useParams();
  const [mensajes, setMensajes] = useState([]);
  const [respuesta, setRespuesta] = useState('');
  const [originalesVisibles, setOriginalesVisibles] = useState({});
  const chatRef = useRef(null);

  useEffect(() => {
    if (!userId) return;

    fetch(`https://web-production-51989.up.railway.app/api/conversaciones/${userId}`)
      .then(res => res.json())
      .then(data => {
        const ordenados = data
          .sort((a, b) => new Date(a.lastInteraction) - new Date(b.lastInteraction))
          .map(msg => ({
            ...msg,
            from: msg.from || (msg.message.startsWith("¡") || msg.message.startsWith("Per ") ? 'asistente' : 'usuario')
          }));
        setMensajes(ordenados);
      })
      .catch(err => {
        console.error("Error cargando mensajes:", err);
      });

    fetch("https://web-production-51989.up.railway.app/api/marcar-visto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    }).then(() => {
      console.log(`✅ Conversación con ${userId} marcada como vista`);
    });

  }, [userId]);

  useEffect(() => {
    chatRef.current?.scrollTo({
      top: chatRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [mensajes]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!respuesta.trim() || !userId) return;

    const nuevoMensaje = {
      userId,
      message: respuesta,
      lastInteraction: new Date().toISOString(),
      from: 'asistente'
    };
    setMensajes(prev => [...prev, nuevoMensaje]);
    setRespuesta('');

    await fetch('https://web-production-51989.up.railway.app/api/send-to-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, message: respuesta })
    });
  };

  const toggleOriginal = (index) => {
    setOriginalesVisibles(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const esURLImagen = (texto) => {
    return typeof texto === 'string' && texto.match(/\.(jpeg|jpg|png|gif|webp)$/i);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <div className="sticky top-0 z-10 bg-blue-800 text-white px-4 py-3 shadow flex items-center justify-between">
        <Link to="/" className="text-sm underline">← Volver</Link>
        <h2 className="text-lg font-semibold text-center flex-1">Conversación con {userId}</h2>
        <div className="w-6" />
      </div>

      <div
        ref={chatRef}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-3"
      >
        {mensajes.length === 0 ? (
          <p className="text-gray-400 text-sm text-center">No hay mensajes todavía.</p>
        ) : (
          mensajes.map((msg, index) => {
            const isAsistente = msg.from === 'asistente';
            const tieneOriginal = !!msg.original;
            const textoColor = isAsistente ? 'text-white' : 'text-gray-500';
            const botonColor = isAsistente ? 'text-white/70' : 'text-blue-500';

            return (
              <div
                key={index}
                className={`flex ${isAsistente ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] px-4 py-2 rounded-2xl text-sm shadow-md ${
                    isAsistente
                      ? 'bg-blue-600 text-white rounded-br-sm'
                      : 'bg-white text-gray-800 rounded-bl-sm border'
                  }`}
                >
                  {esURLImagen(msg.message) ? (
                    <img
                      src={msg.message}
                      alt="Imagen enviada"
                      className="rounded-lg max-w-full mb-2"
                    />
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.message}</p>
                  )}

                  {tieneOriginal && (
                    <div className={`mt-2 text-[11px] text-right ${textoColor}`}>
                      <button
                        onClick={() => toggleOriginal(index)}
                        className={`underline text-xs ${botonColor} focus:outline-none`}
                      >
                        {originalesVisibles[index] ? "Ocultar original" : "Ver original"}
                      </button>
                      {originalesVisibles[index] && (
                        <p className={`mt-1 italic text-left ${textoColor}`}>
                          {msg.original}
                        </p>
                      )}
                    </div>
                  )}

                  <div className={`text-[10px] mt-1 opacity-60 text-right ${isAsistente ? 'text-white' : 'text-gray-500'}`}>
                    {new Date(msg.lastInteraction).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="sticky bottom-0 bg-white border-t flex items-center px-4 py-3"
      >
        <input
          type="text"
          value={respuesta}
          onChange={(e) => setRespuesta(e.target.value)}
          placeholder="Escribe un mensaje..."
          className="flex-1 border rounded-full px-4 py-2 mr-2 focus:outline-none text-sm"
        />
        <button
          type="submit"
          className="bg-blue-600 text-white rounded-full px-4 py-2 text-sm hover:bg-blue-700"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
