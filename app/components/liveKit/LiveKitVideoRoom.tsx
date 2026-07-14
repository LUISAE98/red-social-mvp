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
import { useTranslations } from "next-intl";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Props = {
  sessionId: string;
  sessionType: LivekitSessionType;
  role: "buyer" | "creator";
  onLeave: () => void;
  isMobile?: boolean;
  // El contenedor padre está rotado 90° (móvil en modo apaisado forzado).
  // En ese caso el arrastre del PiP se desactiva para no invertir los ejes.
  rotated?: boolean;
  // Props opcionales — cuando se pasan, el control de fin de sesión y los
  // avisos del timer se delegan al componente padre.
  onEndCallRequest?: () => void;
  onTimerExpired?: () => void;
  onTwoMinWarning?: () => void;
  endSessionRef?: { current: (() => Promise<void>) | null };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function timerColor(s: number): string {
  if (s > 240) return "rgba(255,255,255,0.75)";
  const p = (240 - s) / 240;
  const r = Math.round(255 + (239 - 255) * p);
  const g = Math.round(255 + (68 - 255) * p);
  const b = Math.round(255 + (68 - 255) * p);
  return `rgba(${r},${g},${b},${(0.75 + 0.25 * p).toFixed(2)})`;
}

function collectionForType(sessionType: LivekitSessionType): string {
  return sessionType === "meet_greet" ? "meetGreetRequests" : "exclusiveSessionRequests";
}

// ─── Componente raíz ──────────────────────────────────────────────────────────

export default function LiveKitVideoRoom({
  sessionId,
  sessionType,
  role,
  onLeave,
  isMobile,
  rotated,
  onEndCallRequest,
  onTimerExpired,
  onTwoMinWarning,
  endSessionRef,
}: Props) {
  const tLive = useTranslations("live");
  const roomState = useLivekitRoom({ sessionId, sessionType, enabled: true });

  if (roomState.status === "idle" || roomState.status === "loading") {
    return <StatusScreen message={tLive("connecting")} spinner />;
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
      videoEncoding: { maxBitrate: 3_500_000, maxFramerate: 30 },
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
        isMobile={isMobile}
        rotated={rotated}
        onEndCallRequest={onEndCallRequest}
        onTimerExpired={onTimerExpired}
        onTwoMinWarning={onTwoMinWarning}
        endSessionRef={endSessionRef}
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
  isMobile,
  rotated,
  onEndCallRequest,
  onTimerExpired,
  onTwoMinWarning,
  endSessionRef,
}: {
  sessionId: string;
  sessionType: LivekitSessionType;
  role: "buyer" | "creator";
  onLeave: () => void;
  isMobile?: boolean;
  rotated?: boolean;
  onEndCallRequest?: () => void;
  onTimerExpired?: () => void;
  onTwoMinWarning?: () => void;
  endSessionRef?: { current: (() => Promise<void>) | null };
}) {
  const tLive = useTranslations("live");
  const tCommon = useTranslations("common");
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const room = useRoomContext();

  // Estado para flujo inline de confirmación (solo cuando no hay onEndCallRequest externo)
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const joinCalledRef = useRef(false);
  const timerExpiredFiredRef = useRef(false);
  const twoMinFiredRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const localCameraTrack = cameraTracks.find((t) => t.participant.isLocal);
  const remoteCameraTrack = cameraTracks.find((t) => !t.participant.isLocal);
  const remoteConnected = participants.some((p) => !p.isLocal);

  // ── Deadline desde Firestore ──────────────────────────────────────────────
  const [sessionDeadline, setSessionDeadline] = useState<number | null>(null);

  useEffect(() => {
    const ref = doc(db, collectionForType(sessionType), sessionId);
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as { startedAt?: Timestamp | string; durationMinutes?: number };
      const startedAt = data.startedAt;
      const dur = data.durationMinutes;
      if (startedAt && dur != null) {
        const startedAtMs =
          typeof startedAt === "string"
            ? new Date(startedAt).getTime()
            : startedAt.toMillis();
        setSessionDeadline(startedAtMs + dur * 60 * 1000);
      }
    });
  }, [sessionId, sessionType]);

  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (sessionDeadline == null) return;
    const update = () => setRemaining(Math.max(0, Math.round((sessionDeadline - Date.now()) / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [sessionDeadline]);

  // ── Callbacks de timer ────────────────────────────────────────────────────
  useEffect(() => {
    if (remaining == null || sessionDeadline == null) return;
    if (!twoMinFiredRef.current && remaining <= 120 && remaining > 0) {
      twoMinFiredRef.current = true;
      onTwoMinWarning?.();
    }
    if (!timerExpiredFiredRef.current && remaining === 0) {
      timerExpiredFiredRef.current = true;
      if (onTimerExpired) {
        onTimerExpired();
      } else {
        onLeave();
      }
    }
  }, [remaining, sessionDeadline, onTimerExpired, onTwoMinWarning, onLeave]);

  // ── Join session ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || joinCalledRef.current) return;
    joinCalledRef.current = true;
    callJoinSession({ sessionId, sessionType }).catch((err: unknown) => {
      console.warn("joinSession error:", err);
    });
  }, [connectionState, sessionId, sessionType]);

  // ── endSessionRef — para que el padre pueda disparar el fin ───────────────
  useEffect(() => {
    if (!endSessionRef) return;
    endSessionRef.current = async () => {
      setIsEnding(true);
      try {
        await callEndSession({ sessionId, sessionType });
        await room.disconnect();
      } catch (err: unknown) {
        console.error("endSession error:", err);
      } finally {
        setIsEnding(false);
      }
    };
    return () => {
      if (endSessionRef) endSessionRef.current = null;
    };
  }, [endSessionRef, sessionId, sessionType, room]);

  // ── Flujo de fin inline (fallback cuando no hay onEndCallRequest) ─────────
  const handleEndInline = useCallback(async () => {
    if (!confirmingEnd) { setConfirmingEnd(true); return; }
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

  // ── PiP drag ──────────────────────────────────────────────────────────────
  const [pipPos, setPipPos] = useState<{ x: number; y: number } | null>(null);
  const pipDragRef = useRef<{
    sx: number; sy: number; px: number; py: number;
    cw: number; ch: number; pw: number; ph: number;
  } | null>(null);

  function handlePipPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const root = rootRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const pipRect = e.currentTarget.getBoundingClientRect();
    const spx = pipRect.left - rootRect.left;
    const spy = pipRect.top - rootRect.top;
    pipDragRef.current = {
      sx: e.clientX, sy: e.clientY,
      px: spx, py: spy,
      cw: rootRect.width, ch: rootRect.height,
      pw: pipRect.width, ph: pipRect.height,
    };
    setPipPos((p) => p ?? { x: spx, y: spy });
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handlePipPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pipDragRef.current) return;
    const { sx, sy, px, py, cw, ch, pw, ph } = pipDragRef.current;
    const x = Math.max(0, Math.min(cw - pw, px + (e.clientX - sx)));
    const y = Math.max(0, Math.min(ch - ph, py + (e.clientY - sy)));
    setPipPos({ x, y });
  }

  function handlePipPointerUp() { pipDragRef.current = null; }

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div ref={rootRef} style={styles.root}>

      {/* Video principal — llena todo el contenedor */}
      {isConnecting ? (
        <CenteredLabel>{tLive("connecting")}</CenteredLabel>
      ) : !remoteConnected ? (
        <CenteredLabel>
          {role === "creator" ? tLive("waitingParticipant") : tLive("waitingCreator")}
        </CenteredLabel>
      ) : remoteCameraTrack ? (
        <div style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: isMobile ? "env(safe-area-inset-left, 0px)" : 0,
          right: isMobile ? "env(safe-area-inset-right, 0px)" : 0,
        }}>
          <VideoTrack
            trackRef={remoteCameraTrack}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ) : (
        <CenteredLabel>{tLive("participantCameraOff")}</CenteredLabel>
      )}

      {/* Countdown — top center */}
      {remoteConnected && remaining != null && sessionDeadline != null && (
        <div style={{
          position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
          zIndex: 4,
          display: "inline-flex", alignItems: "center",
          background: "rgba(0,0,0,0.28)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          borderRadius: 6,
          padding: "4px 10px",
          whiteSpace: "nowrap",
        }}>
          <span style={{
            fontFamily: "inherit",
            fontSize: 14, fontWeight: 600,
            color: timerColor(remaining),
            lineHeight: 1,
          }}>
            {formatTime(remaining)}
          </span>
        </div>
      )}

      {/* PiP local — arrastrable, 16:9. Con el panel rotado (móvil apaisado) se fija
          en la esquina para no invertir los ejes del arrastre. */}
      <div
        onPointerDown={rotated ? undefined : handlePipPointerDown}
        onPointerMove={rotated ? undefined : handlePipPointerMove}
        onPointerUp={rotated ? undefined : handlePipPointerUp}
        onPointerCancel={rotated ? undefined : handlePipPointerUp}
        style={{
          position: "absolute",
          ...(rotated || pipPos === null ? { top: 12, right: 12 } : { top: pipPos.y, left: pipPos.x }),
          width: isMobile ? 170 : "clamp(100px, 14%, 160px)",
          aspectRatio: "16/9",
          borderRadius: 10,
          overflow: "hidden",
          background: "#111",
          zIndex: 3,
          cursor: rotated ? "default" : pipDragRef.current ? "grabbing" : "grab",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        {localCameraTrack && isCameraEnabled ? (
          <VideoTrack
            trackRef={localCameraTrack}
            style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a1a" }}>
            <span style={{ fontSize: 18 }}>📷</span>
          </div>
        )}
      </div>

      {/* Controles flotantes */}
      <div style={styles.controls}>

        {/* Mic */}
        <button
          type="button"
          onClick={toggleMic}
          aria-label={isMicrophoneEnabled ? "Silenciar micrófono" : "Activar micrófono"}
          style={styles.iconButton}
        >
          <MicIcon />
          {!isMicrophoneEnabled && <span style={styles.offBadge}><XSmall /></span>}
        </button>

        {/* Cámara */}
        <button
          type="button"
          onClick={toggleCamera}
          aria-label={isCameraEnabled ? "Apagar cámara" : "Encender cámara"}
          style={styles.iconButton}
        >
          <CamIcon />
          {!isCameraEnabled && <span style={styles.offBadge}><XSmall /></span>}
        </button>

        {/* Terminar sesión */}
        {onEndCallRequest ? (
          <button
            type="button"
            onClick={onEndCallRequest}
            disabled={isEnding}
            aria-label="Terminar sesión"
            style={{ ...styles.iconButton, color: "#ef4444", opacity: isEnding ? 0.5 : 1 }}
          >
            <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleEndInline}
              disabled={isEnding}
              aria-label="Terminar sesión"
              style={{
                ...styles.controlButton,
                background: confirmingEnd ? "rgba(220,38,38,0.92)" : "rgba(239,68,68,0.28)",
                borderColor: "rgba(239,68,68,0.50)",
                opacity: isEnding ? 0.6 : 1,
              }}
            >
              {isEnding
                ? tLive("endingSession")
                : confirmingEnd
                ? tLive("confirmEnd")
                : tLive("endSession")}
            </button>
            {confirmingEnd && !isEnding && (
              <button
                type="button"
                onClick={() => setConfirmingEnd(false)}
                style={styles.cancelButton}
              >
                {tCommon("cancel")}
              </button>
            )}
          </>
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

function XSmall() {
  return (
    <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}

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
  const tCommon = useTranslations("common");
  return (
    <div style={styles.statusScreen}>
      {spinner && <div style={styles.spinner} />}
      <p style={{
        color: isError ? "#fca5a5" : "rgba(255,255,255,0.75)",
        fontSize: 15, textAlign: "center",
        margin: "12px 0 0", lineHeight: 1.5, maxWidth: 280,
      }}>
        {message}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} style={styles.retryButton}>
          {retryLabel ?? tCommon("retry")}
        </button>
      )}
    </div>
  );
}

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

const ACCESS_ERROR_CONFIG: Record<AccessErrorVariant, { icon: string; titleKey: string; color: string }> = {
  denied:      { icon: "🔒", titleKey: "errorAccessDenied",  color: "#fca5a5" },
  "not-found": { icon: "🔍", titleKey: "errorNotFound",      color: "#fcd34d" },
  schedule:    { icon: "🕐", titleKey: "errorSchedule",      color: "#fcd34d" },
  cancelled:   { icon: "✕",  titleKey: "errorCancelled",     color: "#fca5a5" },
  ended:       { icon: "✓",  titleKey: "errorEnded",         color: "rgba(255,255,255,0.55)" },
  generic:     { icon: "⚠",  titleKey: "errorGeneric",       color: "#fca5a5" },
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
  const tLive = useTranslations("live");
  const variant = errorVariant(errorCode, message);
  const { icon, titleKey, color } = ACCESS_ERROR_CONFIG[variant];
  const title = tLive(titleKey as Parameters<typeof tLive>[0]);

  return (
    <div style={styles.statusScreen}>
      <span style={{ fontSize: 36, lineHeight: 1 }}>{icon}</span>
      <p style={{ color, fontSize: 15, fontWeight: 700, margin: "8px 0 0", textAlign: "center" }}>
        {title}
      </p>
      <p style={{ color: "rgba(255,255,255,0.60)", fontSize: 13, textAlign: "center", margin: "6px 0 0", lineHeight: 1.5, maxWidth: 260 }}>
        {message}
      </p>
      <button type="button" onClick={onClose} style={styles.retryButton}>
        Cerrar
      </button>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  );
}

function CamIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="23 7 16 12 23 17 23 7"/>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  root: {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    background: "#000",
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
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    gap: 28,
    justifyContent: "center",
    alignItems: "center",
    padding: "20px max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))",
    zIndex: 4,
    flexWrap: "wrap",
  },
  // Botón icono sin contenedor — nuevo estilo Vibra
  iconButton: {
    position: "relative",
    background: "none",
    border: "none",
    padding: 4,
    cursor: "pointer",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    WebkitTapHighlightColor: "transparent",
    flexShrink: 0,
  },
  offBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "#ef4444",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as CSSProperties,
  // Botón con contenedor — fallback inline para la ruta standalone
  controlButton: {
    minHeight: 48,
    padding: "10px 18px",
    borderRadius: 12,
    border: "1px solid",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.1,
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    WebkitTapHighlightColor: "transparent",
  },
  cancelButton: {
    minHeight: 48,
    padding: "10px 16px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.20)",
    background: "rgba(255,255,255,0.10)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    color: "rgba(255,255,255,0.80)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.1,
    WebkitTapHighlightColor: "transparent",
  },
  statusScreen: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    background: "#000",
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
};
