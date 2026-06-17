// Tipos de dominio para LiveKit.
// Usados por el frontend y por las Cloud Functions que los necesiten.

// ---- Estados de sala (por sesión en Firestore) ----

// Estado operativo de la sala LiveKit asociada a una sesión agendada.
export type LiveKitRoomStatus =
  | "scheduled"          // sesión agendada, sala aún no creada
  | "ready"              // sala creada, esperando participantes
  | "in_progress"        // al menos un participante activo
  | "ended"              // llamada finalizada
  | "recording_processing" // grabación en procesamiento post-llamada
  | "recording_ready"    // grabación disponible para descarga
  | "failed";            // error irrecuperable en la sala

// Estado del ciclo de vida de la grabación asociada a la sesión.
export type LiveKitSessionRecordingStatus =
  | "not_started"   // grabación no iniciada
  | "recording"     // grabación activa durante la llamada
  | "processing"    // procesando tras fin de llamada
  | "ready"         // disponible para descarga
  | "failed";       // error en egress

// ---- Campos LiveKit para documentos de sesión en Firestore ----
// Mixin que extienden ExclusiveSessionRequestRecord y MeetGreetRequestRecord.
// Todos los campos son opcionales para mantener compatibilidad con documentos previos.

export interface LiveKitSessionFields {
  // Identificadores de la sala LiveKit
  roomName: string | null;          // nombre único de la sala (generado al crear)
  livekitRoomId: string | null;     // SID asignado por el servidor LiveKit
  livekitEgressId: string | null;   // ID del egress activo para la grabación

  // Estado operativo de la videollamada
  roomStatus: LiveKitRoomStatus;

  // Timestamps de participación en la llamada (ISO string, igual que el resto del documento)
  creatorJoinedAt: string | null;
  buyerJoinedAt: string | null;
  startedAt: string | null;         // momento en que ambos estaban conectados
  endedAt: string | null;           // momento en que la llamada terminó

  // Grabación
  recordingStatus: LiveKitSessionRecordingStatus;
  recordingUrl: string | null;              // URL de descarga cuando esté lista
  recordingDurationSeconds: number | null;  // duración total de la grabación
}

// Valores por defecto para LiveKitSessionFields al crear una nueva sesión.
export const LIVEKIT_SESSION_FIELDS_DEFAULTS: LiveKitSessionFields = {
  roomName: null,
  livekitRoomId: null,
  livekitEgressId: null,
  roomStatus: "scheduled",
  creatorJoinedAt: null,
  buyerJoinedAt: null,
  startedAt: null,
  endedAt: null,
  recordingStatus: "not_started",
  recordingUrl: null,
  recordingDurationSeconds: null,
};

// ---- Salas ----

export interface LiveKitRoomConfig {
  name: string;
  emptyTimeout?: number;     // segundos antes de cerrar una sala vacía
  maxParticipants?: number;
  metadata?: string;
}

// ---- Permisos de participante ----

export interface LiveKitParticipantGrant {
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  roomAdmin?: boolean;
}

// ---- Tokens ----

export interface LiveKitTokenRequest {
  roomName: string;
  participantIdentity: string;   // uid del usuario en Vibra
  participantName: string;       // nombre para mostrar en la sala
  grants?: LiveKitParticipantGrant;
}

export interface LiveKitTokenResponse {
  token: string;
  roomName: string;
  livekitUrl: string;   // URL WebSocket del servidor LiveKit (wss://...)
}

// ---- Grabaciones (Egress) ----

export type LiveKitRecordingStatus = "active" | "complete" | "failed";

export interface LiveKitRecordingInfo {
  egressId: string;
  roomName: string;
  status: LiveKitRecordingStatus;
  startedAt?: number;
  endedAt?: number;
  downloadUrl?: string;
}

// ---- Webhooks ----

export type LiveKitWebhookEventType =
  | "room_started"
  | "room_finished"
  | "participant_joined"
  | "participant_left"
  | "track_published"
  | "egress_started"
  | "egress_updated"
  | "egress_ended";

export interface LiveKitWebhookEvent {
  event: LiveKitWebhookEventType;
  room?: { name: string; sid: string };
  participant?: { identity: string; sid: string; name?: string };
  egressInfo?: { egressId: string; status: string };
  createdAt: number;
}
