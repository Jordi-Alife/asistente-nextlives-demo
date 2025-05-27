import dotenv from "dotenv";
dotenv.config();

import CryptoJS from 'crypto-js';
import { filtrarDatosContexto } from './filtrarDatos.js';

/**
 * Función para llamar al webhook de contexto y obtener datos filtrados
 * @param {Object} payload - Datos a enviar al webhook
 * @returns {Object|null} - Datos filtrados o null en caso de error
 */
export async function llamarWebhookContexto(payload) {
  const webhookUrl = process.env.CONTEXT_WEBHOOK_URL;
  const secret = process.env.CONTEXT_WEBHOOK_SECRET;

  if (!webhookUrl) {
    console.warn("⚠️ CONTEXT_WEBHOOK_URL no está configurada");
    return null;
  }

  if (!secret) {
    console.warn("⚠️ CONTEXT_WEBHOOK_SECRET no está configurada");
    return null;
  }

  try {
    console.log("🚀 Llamando webhook de contexto con payload:", JSON.stringify(payload, null, 2));
    
    const payloadString = JSON.stringify(payload);
    const signature = CryptoJS.HmacSHA256(payloadString, secret).toString(CryptoJS.enc.Hex);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Support-Chat-Signature': signature
      },
      body: payloadString
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log("✅ Webhook de contexto ejecutado exitosamente");
    
    // Filtrar datos según especificaciones
    const rawData = result.data;
    if (!rawData) {
      console.log("⚠️ No raw data received");
      return null;
    }
    
    console.log("🔍 Datos recibidos del webhook antes del filtro:", JSON.stringify(rawData, null, 2));
    const filteredData = filtrarDatosContexto(rawData);
    console.log("✅ Datos filtrados y listos para usar:", JSON.stringify(filteredData, null, 2));
    
    return filteredData;
  } catch (error) {
    console.error("❌ Error llamando webhook de contexto:", error);
    return null;
  }
}
