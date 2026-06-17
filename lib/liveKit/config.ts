// Configuración de LiveKit para el frontend.
// Solo expone la URL pública (WebSocket). La API key y secret son exclusivos del backend.

// Retorna la URL del servidor LiveKit (wss://). Lanza si NEXT_PUBLIC_LIVEKIT_URL no está definida.
export function getLivekitUrl(): string {
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!url) {
    throw new Error(
      "Missing env var: NEXT_PUBLIC_LIVEKIT_URL. " +
        "Defínela en .env.local como NEXT_PUBLIC_LIVEKIT_URL=wss://..."
    );
  }
  return url;
}
