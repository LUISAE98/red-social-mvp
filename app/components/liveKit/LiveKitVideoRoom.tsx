"use client";

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
import { Track, ConnectionState, VideoPresets, type RoomOptions } from "livekit-client";
import { doc, onSnapshot, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function collectionForType(sessionType: LivekitSessionType): string {
  return sessionType === "meet_greet" ? "meetGreetRequests" : "exclusiveSessionRequests";
}

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

  const roomOptions: RoomOptions = {
    videoCaptureDefaults: {
      resolution: VideoPresets.h1080.resolution,
      facingMode: "user",
    },
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
    },
    publishDefaults: {
      videoEncoding: {
        maxBitrate: 3_500_000,
        maxFramerate: 30,
      },
      dtx: true,
      red: true,
      simulcast: false,
    },
    adaptiveStream: true,
    dynacast: false,
  };

  return (
    <LiveKitRoom
      token={token}
      serverUrl={livekitUrl}
      video
      audio
      connect
      options={roomOptions}
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

  // Device detection — pointer:fine identifica laptop/desktop, pointer:coarse = touch/móvil
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine) and (min-width: 768px)");
    setIsDesktop(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });

  const localCameraTrack = cameraTracks.find((t) => t.participant.isLocal);
  const remoteCameraTrack = cameraTracks.find((t) => !t.participant.isLocal);

  const remoteConnected = participants.some((p) => !p.isLocal);

  // ── Deadline sincronizado desde Firestore ─────────────────────────────────
  // Lee scheduledAt + durationMinutes del doc compartido para que ambos
  // participantes computen exactamente el mismo countdown sin depender de props.
  const [sessionDeadline, setSessionDeadline] = useState<number | null>(null);

  useEffect(() => {
    const ref = doc(db, collectionForType(sessionType), sessionId);
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as {
        scheduledAt?: Timestamp;
        durationMinutes?: number;
      };
      const scheduledAt = data.scheduledAt;
      const dur = data.durationMinutes;
      if (scheduledAt && dur != null) {
        setSessionDeadline(scheduledAt.toMillis() + dur * 60 * 1000);
      }
    });
  }, [sessionId, sessionType]);

  // Countdown real-time: ambos participantes leen el mismo deadline absoluto
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (sessionDeadline == null) return;
    const update = () => {
      const r = Math.round((sessionDeadline - Date.now()) / 1000);
      setRemaining(Math.max(0, r));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [sessionDeadline]);

  // Registrar join en Firestore cuando la conexión LiveKit se establece.
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || joinCalledRef.current) return;
    joinCalledRef.current = true;
    callJoinSession({ sessionId, sessionType }).catch((err: unknown) => {
      console.warn("joinSession error (no bloquea la llamada):", err);
    });
  }, [connectionState, sessionId, sessionType]);

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

  // Color del countdown según tiempo restante
  const countdownColor =
    remaining == null
      ? "transparent"
      : remaining <= 60
      ? "#ef4444"
      : remaining <= 300
      ? "#f59e0b"
      : "rgba(255,255,255,0.82)";

  // PiP: en desktop más grande, en móvil más compacto
  const pipSize = isDesktop
    ? "clamp(90px, 14dvw, 140px)"
    : "clamp(72px, 22dvw, 110px)";

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
          <VideoTrack
            trackRef={remoteCameraTrack}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
          />
        ) : (
          <CenteredLabel>Participante conectado · cámara apagada</CenteredLabel>
        )}

        {/* Countdown timer — visible cuando ambos están conectados y hay deadline */}
        {remoteConnected && remaining != null && sessionDeadline != null && (
          <div
            style={{
              position: "absolute",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(0,0,0,0.58)",
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
              borderRadius: 8,
              padding: "5px 12px",
              border: `1px solid ${remaining <= 60 ? "rgba(239,68,68,0.45)" : "rgba(255,255,255,0.12)"}`,
            }}
          >
            {remaining <= 60 && (
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#ef4444",
                  flexShrink: 0,
                  animation: "lkPulse 1s ease-in-out infinite",
                }}
              />
            )}
            <span
              style={{
                fontFamily: "ui-monospace, 'SF Mono', monospace",
                fontSize: isDesktop ? 15 : 13,
                fontWeight: 700,
                color: countdownColor,
                letterSpacing: "0.05em",
                lineHeight: 1,
              }}
            >
              {formatTime(remaining)}
            </span>
          </div>
        )}

        {/* PiP local */}
        {localCameraTrack && isCameraEnabled && (
          <div
            style={{
              ...styles.pipWrapper,
              width: pipSize,
            }}
          >
            <VideoTrack
              trackRef={localCameraTrack}
              style={{ ...styles.pipVideo, transform: "scaleX(-1)" }}
            />
          </div>
        )}

        {/* Indicador de cámara local apagada */}
        {!isCameraEnabled && (
          <div
            style={{
              ...styles.pipWrapper,
              width: pipSize,
            }}
          >
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

        <button
          type="button"
          onClick={handleEndSession}
          disabled={isEnding}
          style={{ ...styles.endButton, opacity: isEnding ? 0.6 : 1 }}
        >
          {isEnding ? "Finalizando…" : confirmingEnd ? "¿Confirmar fin?" : "Finalizar sesión"}
        </button>

        {confirmingEnd && !isEnding && (
          <button type="button" onClick={() => setConfirmingEnd(false)} style={styles.cancelButton}>
            Cancelar
          </button>
        )}
      </div>

      <style>{`
        @keyframes lkPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes lk-spin  { to{transform:rotate(360deg)} }
      `}</style>
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
  denied:      { icon: "🔒", title: "Acceso denegado",      color: "#fca5a5" },
  "not-found": { icon: "🔍", title: "Sesión no encontrada", color: "#fcd34d" },
  schedule:    { icon: "🕐", title: "Fuera de horario",     color: "#fcd34d" },
  cancelled:   { icon: "✕",  title: "Sesión cancelada",     color: "#fca5a5" },
  ended:       { icon: "✓",  title: "Sesión finalizada",    color: "rgba(255,255,255,0.55)" },
  generic:     { icon: "⚠",  title: "No disponible",        color: "#fca5a5" },
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
    background: "#0a0a0a",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  pipWrapper: {
    position: "absolute",
    bottom: 12,
    right: 12,
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
