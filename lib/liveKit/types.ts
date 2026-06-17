// Tipos de LiveKit para el frontend — re-exporta tipos de dominio y agrega estado de sesión.

export type {
  LiveKitRoomConfig,
  LiveKitParticipantGrant,
  LiveKitTokenRequest,
  LiveKitTokenResponse,
  LiveKitRecordingInfo,
  LiveKitRecordingStatus,
  LiveKitWebhookEvent,
  LiveKitWebhookEventType,
} from "@/types/livekit";

// Estado de una sesión LiveKit activa en el cliente React.
export interface LiveKitSessionState {
  roomName: string;
  token: string;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
}
