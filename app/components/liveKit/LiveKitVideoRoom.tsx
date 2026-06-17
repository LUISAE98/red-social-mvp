"use client";

// Componente de videollamada LiveKit para sesiones exclusivas y meet & greet.
// Gestiona conexión, video, audio y controles dentro del panel fullscreen existente.

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  VideoTrack,
  RoomAudioRenderer,
  useTracks,
  useLocalParticipant,
  useRoomContext,
  useConnectionState,
  useParticipants,
} from "@livekit/components-react";
import { Track, ConnectionState } from "livekit-client";
import { useLivekitRoom } from "@/lib/liveKit/useLivekitRoom";
import type { LivekitSessionType, LivekitErrorCode } from "@/lib/liveKit/getLivekitToken";
import { callJoinSession, callEndSession } from "@/lib/liveKit/sessionLifecycle";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Props = {
  sessionId: string;
  sessionType: LivekitSessionType;
  role: "buyer" | "creator";
  onLeave: () => void;
};

// ─── Componente raíz ──────────────────────────────────────────────────────────

export default function LiveKitVideoRoom({ sessionId, sessionType, role, onLeave }: Props) {
  const roomState = useLivekitRoom({ sessionId, sessionType, enabled: true });

  if (roomState.status === "idle" || roomState.status === "loading") {
    return <StatusScreen message="Conectando…" spinner />;
  }

  if (roomState.status === "error") {
    return (
      <AccessErrorScreen
        message={roomState.message}
        errorCode={roomState.errorCode}
        onClose={onLeave}
      />
    );
  }

  const { token, livekitUrl } = roomState.data;

  return (
    <LiveKitRoom
      token={token}
      serverUrl={livekitUrl}
      video
      audio
      connect
      onMediaDeviceFailure={(failure, kind) => {
        console.warn("livekit_device_failure", { failure, kind });
      }}
      style={{ display: "contents" }}
    >
      <RoomContent
        sessionId={sessionId}
        sessionType={sessionType}
        role={role}
        onLeave={onLeave}
      />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

// ─── Contenido dentro del contexto de sala ────────────────────────────────────

function RoomContent({
  sessionId,
  sessionType,
  role,
  onLeave,
}: {
  sessionId: string;
  sessionType: LivekitSessionType;
  role: "buyer" | "creator";
  onLeave: () => void;
}) {
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const room = useRoomContext();
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const joinCalledRef = useRef(false);

  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });

  const localCameraTrack = cameraTracks.find((t) => t.participant.isLocal);
  const remoteCameraTrack = cameraTracks.find((t) => !t.participant.isLocal);

  const remoteConnected = participants.some((p) => !p.isLocal);

  // Registrar join en Firestore cuando la conexión LiveKit se establece.
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || joinCalledRef.current) return;
    joinCalledRef.current = true;
    callJoinSession({ sessionId, sessionType }).catch((err: unknown) => {
      console.warn("joinSession error (no bloquea la llamada):", err);
    });
  }, [connectionState, sessionId, sessionType]);

  const handleLeave = useCallback(async () => {
    await room.disconnect();
    onLeave();
  }, [room, onLeave]);

  const handleEndSession = useCallback(async () => {
    if (!confirmingEnd) {
      setConfirmingEnd(true);
      return;
    }
    setIsEnding(true);
    try {
      await callEndSession({ sessionId, sessionType });
      await room.disconnect();
      onLeave();
    } catch (err: unknown) {
      console.error("endSession error:", err);
      setIsEnding(false);
      setConfirmingEnd(false);
    }
  }, [confirmingEnd, sessionId, sessionType, room, onLeave]);

  const toggleMic = useCallback(() => {
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }, [localParticipant, isMicrophoneEnabled]);

  const toggleCamera = useCallback(() => {
    localParticipant.setCameraEnabled(!isCameraEnabled);
  }, [localParticipant, isCameraEnabled]);

  const isConnecting =
    connectionState === ConnectionState.Connecting ||
    connectionState === ConnectionState.Reconnecting;

  // ── Layout ───────────────────────────────────────────────────────────────────
  return (
    <div style={styles.root}>
      {/* Área de video principal */}
      <div style={styles.videoArea}>
        {isConnecting ? (
          <CenteredLabel>Conectando…</CenteredLabel>
        ) : !remoteConnected ? (
          <CenteredLabel>
            {role === "creator"
              ? "Esperando que el participante se una…"
              : "Esperando que el creador se una…"}
          </CenteredLabel>
        ) : remoteCameraTrack ? (
          <VideoTrack trackRef={remoteCameraTrack} style={styles.remoteVideo} />
        ) : (
          <CenteredLabel>Participante conectado · cámara apagada</CenteredLabel>
        )}

        {/* PiP local */}
        {localCameraTrack && isCameraEnabled && (
          <div style={styles.pipWrapper}>
            <VideoTrack trackRef={localCameraTrack} style={{ ...styles.pipVideo, transform: "scaleX(-1)" }} />
          </div>
        )}

        {/* Indicador de cámara local apagada */}
        {!isCameraEnabled && (
          <div style={styles.pipWrapper}>
            <div style={styles.pipPlaceholder}>
              <span style={{ fontSize: 22 }}>📷</span>
            </div>
          </div>
        )}
      </div>

      {/* Barra de controles */}
      <div style={styles.controls}>
        <ControlButton
          onClick={toggleMic}
          active={isMicrophoneEnabled}
          label={isMicrophoneEnabled ? "Mic ON" : "Mic OFF"}
        />
        <ControlButton
          onClick={toggleCamera}
          active={isCameraEnabled}
          label={isCameraEnabled ? "Cám ON" : "Cám OFF"}
        />

        {/* Salir sin finalizar */}
        {!confirmingEnd && (
          <button type="button" onClick={handleLeave} style={styles.leaveButton}>
            Salir
          </button>
        )}

        {/* Finalizar sesión (dos pasos) */}
        <button
          type="button"
          onClick={handleEndSession}
          disabled={isEnding}
          style={{
            ...styles.endButton,
            opacity: isEnding ? 0.6 : 1,
          }}
        >
          {isEnding
            ? "Finalizando…"
            : confirmingEnd
            ? "¿Confirmar fin?"
            : "Finalizar sesión"}
        </button>

        {/* Cancelar confirmación */}
        {confirmingEnd && !isEnding && (
          <button
            type="button"
            onClick={() => setConfirmingEnd(false)}
            style={styles.cancelButton}
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Subcomponentes simples ───────────────────────────────────────────────────

function CenteredLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={styles.centeredLabel}>
      <p style={{ color: "rgba(255,255,255,0.72)", fontSize: 15, textAlign: "center", margin: 0 }}>
        {children}
      </p>
    </div>
  );
}

function StatusScreen({
  message,
  spinner,
  isError,
  onRetry,
  retryLabel,
}: {
  message: string;
  spinner?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div style={styles.statusScreen}>
      {spinner && <div style={styles.spinner} />}
      <p
        style={{
          color: isError ? "#fca5a5" : "rgba(255,255,255,0.75)",
          fontSize: 15,
          textAlign: "center",
          margin: "12px 0 0",
          lineHeight: 1.5,
          maxWidth: 280,
        }}
      >
        {message}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} style={styles.retryButton}>
          {retryLabel ?? "Reintentar"}
        </button>
      )}
    </div>
  );
}

// ─── Pantalla de error de acceso ─────────────────────────────────────────────

type AccessErrorVariant = "denied" | "not-found" | "schedule" | "cancelled" | "ended" | "generic";

function errorVariant(code: LivekitErrorCode, message: string): AccessErrorVariant {
  if (code === "permission-denied" || code === "unauthenticated") return "denied";
  if (code === "not-found") return "not-found";
  if (code === "failed-precondition") {
    if (message.includes("cancelada")) return "cancelled";
    if (message.includes("finalizado")) return "ended";
    if (message.includes("hora") || message.includes("expiró")) return "schedule";
  }
  return "generic";
}

const ACCESS_ERROR_CONFIG: Record<AccessErrorVariant, { icon: string; title: string; color: string }> = {
  denied:    { icon: "🔒", title: "Acceso denegado",      color: "#fca5a5" },
  "not-found": { icon: "🔍", title: "Sesión no encontrada", color: "#fcd34d" },
  schedule:  { icon: "🕐", title: "Fuera de horario",     color: "#fcd34d" },
  cancelled: { icon: "✕",  title: "Sesión cancelada",     color: "#fca5a5" },
  ended:     { icon: "✓",  title: "Sesión finalizada",    color: "rgba(255,255,255,0.55)" },
  generic:   { icon: "⚠",  title: "No disponible",        color: "#fca5a5" },
};

function AccessErrorScreen({
  message,
  errorCode,
  onClose,
}: {
  message: string;
  errorCode: LivekitErrorCode;
  onClose: () => void;
}) {
  const variant = errorVariant(errorCode, message);
  const { icon, title, color } = ACCESS_ERROR_CONFIG[variant];

  return (
    <div style={styles.statusScreen}>
      <span style={{ fontSize: 36, lineHeight: 1 }}>{icon}</span>
      <p style={{ color, fontSize: 15, fontWeight: 700, margin: "8px 0 0", textAlign: "center" }}>
        {title}
      </p>
      <p
        style={{
          color: "rgba(255,255,255,0.60)",
          fontSize: 13,
          textAlign: "center",
          margin: "6px 0 0",
          lineHeight: 1.5,
          maxWidth: 260,
        }}
      >
        {message}
      </p>
      <button type="button" onClick={onClose} style={styles.retryButton}>
        Cerrar
      </button>
    </div>
  );
}

function ControlButton({
  onClick,
  active,
  label,
}: {
  onClick: () => void;
  active: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...styles.controlButton,
        background: active ? "rgba(255,255,255,0.10)" : "rgba(255,80,80,0.20)",
        borderColor: active ? "rgba(255,255,255,0.18)" : "rgba(255,80,80,0.35)",
      }}
    >
      {label}
    </button>
  );
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  root: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "minmax(0,1fr) auto",
    gap: 10,
    overflow: "hidden",
  },
  videoArea: {
    position: "relative",
    minHeight: 0,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "linear-gradient(180deg,rgba(18,18,18,0.99) 0%,rgba(6,6,6,0.99) 100%)",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  remoteVideo: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: 16,
  },
  pipWrapper: {
    position: "absolute",
    bottom: 12,
    right: 12,
    width: "clamp(80px,18dvw,130px)",
    aspectRatio: "3/4",
    borderRadius: 10,
    overflow: "hidden",
    border: "1.5px solid rgba(255,255,255,0.18)",
    background: "#111",
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
    zIndex: 2,
  },
  pipVideo: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  pipPlaceholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#1a1a1a",
  },
  centeredLabel: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  controls: {
    display: "flex",
    gap: 10,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
    padding: "4px 0 max(8px,env(safe-area-inset-bottom))",
    flexWrap: "wrap",
  },
  controlButton: {
    minHeight: 44,
    padding: "10px 18px",
    borderRadius: 12,
    border: "1px solid",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.1,
    WebkitTapHighlightColor: "transparent",
    transition: "background 0.15s",
  },
  leaveButton: {
    minHeight: 44,
    padding: "10px 22px",
    borderRadius: 12,
    border: "1px solid rgba(255,80,80,0.45)",
    background: "rgba(220,38,38,0.75)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.1,
    WebkitTapHighlightColor: "transparent",
  },
  statusScreen: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  spinner: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: "3px solid rgba(255,255,255,0.15)",
    borderTopColor: "#fff",
    animation: "lk-spin 0.8s linear infinite",
  },
  retryButton: {
    marginTop: 8,
    minHeight: 40,
    padding: "9px 20px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.20)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
  },
  endButton: {
    minHeight: 44,
    padding: "10px 18px",
    borderRadius: 12,
    border: "1px solid rgba(255,80,80,0.45)",
    background: "rgba(220,38,38,0.75)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.1,
    WebkitTapHighlightColor: "transparent",
  },
  cancelButton: {
    minHeight: 44,
    padding: "10px 16px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.07)",
    color: "rgba(255,255,255,0.75)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.1,
    WebkitTapHighlightColor: "transparent",
  },
};
