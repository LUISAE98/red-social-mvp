import type { Timestamp } from "firebase/firestore";

/**
 * Sesión activa de un usuario (un dispositivo/navegador donde inició sesión).
 * Vive en la subcolección `users/{uid}/sessions/{sessionId}`.
 *
 * El `sessionId` se genera en el cliente (crypto.randomUUID) y se guarda en
 * localStorage bajo SESSION_ID_STORAGE_KEY para poder identificar "este
 * dispositivo" y refrescar el heartbeat del mismo doc entre recargas.
 */
export type UserSession = {
  /** Coincide con el id del documento y con el valor en localStorage. */
  id: string;
  /** Cuándo se inició esta sesión en este dispositivo. */
  createdAt: Timestamp | null;
  /** Última señal de vida (heartbeat) — para "activo hace X". */
  lastSeenAt: Timestamp | null;
  /** User agent crudo del navegador. */
  userAgent: string | null;
  /** Etiqueta legible derivada del user agent, ej. "Chrome · Windows". */
  deviceLabel: string;
  /** Zona horaria IANA del navegador, ej. "America/Mexico_City". */
  timezone: string | null;
  /**
   * Ubicación aproximada mostrable. Al registrar se deriva de la zona horaria
   * del navegador; la Cloud Function de geo-IP la sobrescribe con la
   * ciudad/país reales del request.
   */
  locationLabel: string | null;
  /** Ciudad resuelta por geo-IP (Cloud Function). null si no se resolvió. */
  city: string | null;
  /** País resuelto por geo-IP (Cloud Function). null si no se resolvió. */
  country: string | null;
  /**
   * Marca de cierre remoto. Cuando otro dispositivo la pone en `true`, el
   * dispositivo dueño de esta sesión cierra sesión automáticamente al detectarlo.
   */
  revoked: boolean;
  revokedAt: Timestamp | null;
};

/** Clave de localStorage donde vive el id de sesión de este dispositivo. */
export const SESSION_ID_STORAGE_KEY = "vibra_session_id";
