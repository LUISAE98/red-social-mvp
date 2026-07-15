// LiveKit backend module — credentials, client factory y utilidades base.
// Las funciones que generen tokens o administren salas deben importar desde aquí.

import { RoomServiceClient, AccessToken, EgressClient, type VideoGrant } from "livekit-server-sdk";
import { defineSecret } from "firebase-functions/params";

export const livekitApiKey = defineSecret("LIVEKIT_API_KEY");
export const livekitApiSecret = defineSecret("LIVEKIT_API_SECRET");

// Credenciales S3 para almacenamiento de grabaciones via Egress.
// Opcionales: si no están configuradas, el egress se omite silenciosamente.
export const egressS3AccessKey = defineSecret("LIVEKIT_EGRESS_S3_ACCESS_KEY");
export const egressS3SecretKey = defineSecret("LIVEKIT_EGRESS_S3_SECRET_KEY");

// La URL de LiveKit no es un secreto pero se lee desde env para flexibilidad por entorno.
function getLivekitUrl(): string {
  const url = process.env.LIVEKIT_URL;
  if (!url) throw new Error("Missing required env var: LIVEKIT_URL");
  return url;
}

// Crea un cliente de administración de salas (Room Service).
// Requiere que la función declare livekitApiKey y livekitApiSecret como secrets.
export function createRoomServiceClient(): RoomServiceClient {
  return new RoomServiceClient(
    getLivekitUrl(),
    livekitApiKey.value(),
    livekitApiSecret.value()
  );
}

// Crea un cliente de Egress para gestionar grabaciones.
// Requiere que la función declare livekitApiKey y livekitApiSecret como secrets.
export function createEgressClient(): EgressClient {
  return new EgressClient(
    getLivekitUrl(),
    livekitApiKey.value(),
    livekitApiSecret.value()
  );
}

// Crea un AccessToken base para generar JWTs de participantes.
// El caller es responsable de agregar grants y llamar .toJwt().
export function createAccessToken(): AccessToken {
  return new AccessToken(livekitApiKey.value(), livekitApiSecret.value());
}

// Genera un JWT firmado para que un participante se una a una sala.
// TTL por defecto: 4 horas — suficiente para cualquier sesión con margen.
export async function createParticipantToken(params: {
  roomName: string;
  identity: string;
  displayName: string;
  metadata?: string;
  ttlSeconds?: number;
}): Promise<string> {
  const { roomName, identity, displayName, metadata, ttlSeconds = 14400 } = params;

  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };

  const token = new AccessToken(livekitApiKey.value(), livekitApiSecret.value(), {
    identity,
    name: displayName,
    metadata,
    ttl: ttlSeconds,
  });
  token.addGrant(grant);

  return token.toJwt();
}
