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
import { callJoinSession, callEndSession, callSignalSessionClosing } from "@/lib/liveKit/sessionLifecycle";
import { useTranslations, useLocale } from "next-intl";

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
  onFarewellWarning?: () => void;
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
  onFarewellWarning,
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
      // 720p (no 1080p): con simulcast apagado hay una sola capa, y 720p llega a
      // calidad plena mucho más rápido que 1080p → menos pixeleo al arranque en
      // redes normales. La grabación se sigue componiendo a 1080p (canvas +
      // overlays + intro nítidos); solo la cámara entra a 720p re-escalada.
      resolution: VideoPresets.h720.resolution,
      facingMode: "user",
    },
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
    },
    publishDefaults: {
      videoEncoding: { maxBitrate: 2_000_000, maxFramerate: 30 },
      // H.264 usa el encoder por HARDWARE del teléfono → mucho menos CPU/calor
      // y menos latencia en móvil que el default VP8 (por software). No afecta la
      // grabación (el egress re-codifica a H264 de todos modos).
      videoCodec: "h264",
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
        onFarewellWarning={onFarewellWarning}
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
  onEndCallRequest,
  onTimerExpired,
  onTwoMinWarning,
  onFarewellWarning,
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
  onFarewellWarning?: () => void;
  endSessionRef?: { current: (() => Promise<void>) | null };
}) {
  const tLive = useTranslations("live");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const room = useRoomContext();

  // Estado para flujo inline de confirmación (solo cuando no hay onEndCallRequest externo)
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const joinCalledRef = useRef(false);
  const timerExpiredFiredRef = useRef(false);
  const overlayOutFiredRef = useRef(false);
  const twoMinFiredRef = useRef(false);
  const farewellFiredRef = useRef(false);
  const expiryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Gracia al llegar a 0: la llamada NO se corta de golpe. Se difumina y corre un
  // contador de 10→0 al centro para que ambos sepan que SIGUE GRABANDO y no
  // suelten algo indebido creyendo que ya terminó. A los 10s sí se cierra.
  const [graceLeft, setGraceLeft] = useState<number | null>(null);

  const allTracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: false,
  });
  const cameraTracks = allTracks.filter((t) => t.source === Track.Source.Camera);
  const localCameraTrack = cameraTracks.find((t) => t.participant.isLocal);
  const remoteCameraTrack = cameraTracks.find((t) => !t.participant.isLocal);
  // Pantalla compartida: solo la publica el creador (ver botón más abajo).
  const screenTrack = allTracks.find((t) => t.source === Track.Source.ScreenShare);
  const remoteConnected = participants.some((p) => !p.isLocal);

  // ── Contador pausable desde Firestore ─────────────────────────────────────
  // El backend mantiene timerRemainingMs (restante congelado al pausar) y
  // timerRunningSince (ISO cuando ambos están conectados; null si pausado). El
  // contador corre solo con ambos presentes y NUNCA se reinicia. Fallback
  // legacy: startedAt + duración (comportamiento viejo, sin pausa).
  const [timer, setTimer] = useState<{ remainingMs: number; runningSince: number | null } | null>(null);

  useEffect(() => {
    const ref = doc(db, collectionForType(sessionType), sessionId);
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as {
        startedAt?: Timestamp | string;
        durationMinutes?: number;
        timerRemainingMs?: number;
        timerRunningSince?: Timestamp | string | null;
      };
      const toMs = (v: Timestamp | string | null | undefined): number | null => {
        if (!v) return null;
        return typeof v === "string" ? new Date(v).getTime() : v.toMillis();
      };
      if (typeof data.timerRemainingMs === "number") {
        setTimer({ remainingMs: data.timerRemainingMs, runningSince: toMs(data.timerRunningSince) });
      } else if (data.startedAt && data.durationMinutes != null) {
        setTimer({ remainingMs: data.durationMinutes * 60 * 1000, runningSince: toMs(data.startedAt) });
      }
    });
  }, [sessionId, sessionType]);

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining =
    timer == null
      ? null
      : Math.max(
          0,
          Math.round(
            (timer.runningSince != null
              ? timer.remainingMs - (nowTick - timer.runningSince)
              : timer.remainingMs) / 1000
          )
        );

  // ── Callbacks de timer ────────────────────────────────────────────────────
  useEffect(() => {
    if (remaining == null || timer == null) return;
    if (!twoMinFiredRef.current && remaining <= 120 && remaining > 0) {
      twoMinFiredRef.current = true;
      onTwoMinWarning?.();
    }
    // Aviso de despedida a los 20s: mismo estilo que el de 2 min, en el centro.
    if (!farewellFiredRef.current && remaining <= 20 && remaining > 0) {
      farewellFiredRef.current = true;
      onFarewellWarning?.();
    }
    // t=-5: avisamos a la GRABACIÓN que desvanezca el overlay de la esquina.
    // No toca la sesión ni el contador; es solo cosmético en el archivo grabado.
    if (!overlayOutFiredRef.current && remaining <= 5 && remaining > 0) {
      overlayOutFiredRef.current = true;
      callSignalSessionClosing({ sessionId, sessionType, phase: "overlay_out" }).catch(() => {});
    }
    if (!timerExpiredFiredRef.current && remaining === 0) {
      timerExpiredFiredRef.current = true;
      // ⚠️ NO adelantar el cierre a t=0: eso quita el contador de la llamada en
      // vivo (ya rompió una vez). En t=0 SOLO se señala la grabación; el cierre
      // real (endSession + onTimerExpired) va en el setTimeout de 10s de abajo. ⚠️
      // En t=0 solo señalamos el INICIO del cierre a la GRABACIÓN (para que su
      // outro arranque). Esto NO toca la sesión: la videollamada y el contador
      // de los participantes siguen intactos durante la gracia.
      callSignalSessionClosing({ sessionId, sessionType, phase: "closing" }).catch(() => {});
      // Gracia VISIBLE de 10s: la llamada se difumina y corre el contador 10→0 al
      // centro (aviso de que sigue grabando). Recién a los 10s finalizamos la
      // sesión (status→completed) y cerramos. Idempotente entre ambos.
      setGraceLeft(10);
      expiryTimeoutRef.current = setTimeout(() => {
        callEndSession({ sessionId, sessionType }).catch((e) =>
          console.error("endSession on expiry:", e)
        );
        if (onTimerExpired) {
          onTimerExpired();
        } else {
          onLeave();
        }
      }, 10000);
    }
  }, [remaining, timer, onTimerExpired, onTwoMinWarning, onFarewellWarning, onLeave, sessionId, sessionType]);

  // Cuenta regresiva visible de la gracia (10 → 0) mientras la llamada está borrosa.
  useEffect(() => {
    if (graceLeft == null || graceLeft <= 0) return;
    const t = setTimeout(() => setGraceLeft((g) => (g != null ? g - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [graceLeft]);

  // Limpia la gracia de expiración solo al desmontar.
  useEffect(() => {
    return () => {
      if (expiryTimeoutRef.current) clearTimeout(expiryTimeoutRef.current);
    };
  }, []);

  // ── Join session ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || joinCalledRef.current) return;
    joinCalledRef.current = true;
    callJoinSession({ sessionId, sessionType, locale }).catch((err: unknown) => {
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

  // ── Compartir pantalla ────────────────────────────────────────────────────
  // Solo el CREADOR, y solo donde funciona de verdad: exigimos escritorio Y que
  // getDisplayMedia exista. (Safari de iOS/iPadOS no lo soporta, y un iPad con
  // teclado reporta "pointer: fine" — por eso no basta con detectar escritorio.)
  const canShareScreen =
    role === "creator" &&
    !isMobile &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function";
  const isSharingScreen = !!screenTrack?.participant.isLocal;

  const toggleScreenShare = useCallback(async () => {
    if (!canShareScreen) return;
    try {
      await localParticipant.setScreenShareEnabled(!isSharingScreen);
    } catch {
      // El usuario canceló el diálogo de selección de pantalla — no es un error.
    }
  }, [canShareScreen, localParticipant, isSharingScreen]);

  const isConnecting =
    connectionState === ConnectionState.Connecting ||
    connectionState === ConnectionState.Reconnecting;

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div ref={rootRef} style={styles.root}>

      {/* Video principal — llena todo el contenedor. Si el creador está
          compartiendo pantalla, ésta toma el cuadro grande. Durante la gracia de
          cierre (contador en 0) todo se difumina suavemente. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          filter: graceLeft != null ? "blur(16px)" : "none",
          transform: graceLeft != null ? "scale(1.04)" : "none",
          transition: "filter 1.2s ease, transform 1.2s ease",
        }}
      >
        {isConnecting ? (
          <CenteredLabel>{tLive("connecting")}</CenteredLabel>
        ) : !remoteConnected ? (
          <CenteredLabel>
            {role === "creator" ? tLive("waitingParticipant") : tLive("waitingCreator")}
          </CenteredLabel>
        ) : screenTrack || remoteCameraTrack ? (
          <div style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            insetInlineStart: isMobile ? "env(safe-area-inset-left, 0px)" : 0,
            insetInlineEnd: isMobile ? "env(safe-area-inset-right, 0px)" : 0,
          }}>
            <VideoTrack
              trackRef={(screenTrack ?? remoteCameraTrack)!}
              style={{
                width: "100%",
                height: "100%",
                objectFit: screenTrack ? "contain" : "cover",
                background: screenTrack ? "#000" : undefined,
              }}
            />
          </div>
        ) : (
          <CenteredLabel>{tLive("participantCameraOff")}</CenteredLabel>
        )}

        {/* Cámara del remoto en PiP extra cuando la pantalla ocupa el cuadro grande. */}
        {screenTrack && remoteCameraTrack ? (
          <div
            style={{
              position: "absolute",
              insetInlineStart: isMobile ? "max(14px, env(safe-area-inset-left))" : 14,
              bottom: isMobile ? "max(28px, var(--vb-safe-bottom, 0px))" : 28,
              width: "18%",
              aspectRatio: "16 / 9",
              borderRadius: 8,
              overflow: "hidden",
              border: "1.5px solid rgba(255,255,255,0.7)",
              background: "#111",
              zIndex: 3,
            }}
          >
            <VideoTrack
              trackRef={remoteCameraTrack}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        ) : null}
      </div>

      {/* Gracia de cierre — contador 10→0 al centro. Avisa que SIGUE GRABANDO
          para que nadie crea que ya terminó. Números normales, discretos. */}
      {graceLeft != null && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.75)", letterSpacing: "0.01em" }}>
            {tLive("stillRecording")}
          </span>
          <span style={{ fontSize: 30, fontWeight: 600, color: "#fff", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {Math.max(0, graceLeft)}
          </span>
        </div>
      )}

      {/* ⚠️ CONTADOR DE LA SESIÓN — NO ELIMINAR NI OCULTAR NUNCA ⚠️
          Este contador (arriba al centro) es una feature crítica pedida
          explícitamente por el dueño del producto. NO tocar esta condición de
          render, ni `remaining`, ni `timer`, ni la lógica que los alimenta
          (joinSession fija startedAt+timerRemainingMs; el webhook pausa/reanuda;
          la expiración en t=0 SOLO señala la grabación y el cierre real es en
          t=10). Si un cambio parece requerir modificarlo, DETENERSE y preguntar. */}
      {/* Countdown — top center */}
      {remoteConnected && remaining != null && timer != null && (
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

      {/* PiP local — fijo en la esquina inferior derecha, 16:9, no arrastrable,
          con margen considerable respecto a los bordes del dispositivo. */}
      <div
        style={{
          position: "absolute",
          bottom: isMobile ? "max(28px, var(--vb-safe-bottom, 0px))" : 28,
          insetInlineEnd: isMobile ? "max(28px, env(safe-area-inset-right))" : 28,
          width: isMobile ? 221 : "clamp(130px, 18%, 208px)",
          aspectRatio: "16/9",
          borderRadius: 10,
          overflow: "hidden",
          background: "#111",
          zIndex: 3,
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
          aria-label={isMicrophoneEnabled ? "Silenciar micrófono" : tLive("micUnmute")}
          style={styles.iconButton}
        >
          <MicIcon />
          {!isMicrophoneEnabled && <span style={styles.offBadge}><XSmall /></span>}
        </button>

        {/* Cámara */}
        <button
          type="button"
          onClick={toggleCamera}
          aria-label={isCameraEnabled ? "Apagar cámara" : tLive("camOn")}
          style={styles.iconButton}
        >
          <CamIcon />
          {!isCameraEnabled && <span style={styles.offBadge}><XSmall /></span>}
        </button>

        {/* Compartir pantalla — solo el creador y solo donde funciona de verdad
            (escritorio con getDisplayMedia). En iPhone/iPad no se renderiza. */}
        {canShareScreen && (
          <button
            type="button"
            onClick={toggleScreenShare}
            aria-label={isSharingScreen ? tLive("stopScreenShare") : tLive("screenShare")}
            style={{ ...styles.iconButton, color: isSharingScreen ? "#a855f7" : undefined }}
          >
            <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>
        )}

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

/* Estas palabras NO se muestran: se buscan dentro del mensaje que manda el
   backend, que viene en español. Traducirlas rompería la comparación. */
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

const ACCESS_ERROR_CONFIG: Record<
  AccessErrorVariant,
  { titleKey: string; iconColor: string; circleBg: string; positive: boolean }
> = {
  // `ended` es la única "positiva": la sesión terminó bien / la cerró el otro.
  // Va con paloma morada + botón morado, igual que el panel de descarga.
  denied:      { titleKey: "errorAccessDenied", iconColor: "#fca5a5", circleBg: "rgba(248,113,113,0.14)", positive: false },
  "not-found": { titleKey: "errorNotFound",     iconColor: "#fcd34d", circleBg: "rgba(250,204,21,0.14)",  positive: false },
  schedule:    { titleKey: "errorSchedule",     iconColor: "#fcd34d", circleBg: "rgba(250,204,21,0.14)",  positive: false },
  cancelled:   { titleKey: "errorCancelled",    iconColor: "#fca5a5", circleBg: "rgba(248,113,113,0.14)", positive: false },
  ended:       { titleKey: "errorEnded",        iconColor: "#a855f7", circleBg: "rgba(168,85,255,0.15)",  positive: true },
  generic:     { titleKey: "errorGeneric",      iconColor: "#fca5a5", circleBg: "rgba(248,113,113,0.14)", positive: false },
};

// Ícono SVG limpio por variante (reemplaza los emojis "✓ ✕ 🔒 …" que se veían feos).
function AccessErrorIcon({ variant, color }: { variant: AccessErrorVariant; color: string }) {
  const p = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (variant) {
    case "ended":
      return <svg {...p}><polyline points="20 6 9 17 4 12" /></svg>;
    case "cancelled":
      return <svg {...p}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>;
    case "denied":
      return <svg {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
    case "not-found":
      return <svg {...p}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
    case "schedule":
      return <svg {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
    default:
      return <svg {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
  }
}

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
  const cfg = ACCESS_ERROR_CONFIG[variant];
  const title = tLive(cfg.titleKey as Parameters<typeof tLive>[0]);

  // Mismo lenguaje visual que la tarjeta de descarga: card oscura centrada,
  // círculo de color con ícono limpio, título, mensaje y botón.
  return (
    <div style={styles.statusScreen}>
      <div style={{
        width: "min(100%, 340px)",
        borderRadius: 18,
        background: "#0a0a0a",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
        overflow: "hidden",
        padding: "32px 24px 28px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
        textAlign: "center",
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: cfg.circleBg,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <AccessErrorIcon variant={variant} color={cfg.iconColor} />
        </div>

        <div>
          <p style={{ color: "#fff", fontSize: 16, fontWeight: 600, margin: "0 0 8px", lineHeight: 1.3 }}>
            {title}
          </p>
          <p style={{ color: "rgba(255,255,255,0.50)", fontSize: 13, margin: 0, lineHeight: 1.55 }}>
            {message}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%", height: 42, borderRadius: 5, border: "none",
            background: cfg.positive ? "#a855f7" : "rgba(255,255,255,0.10)",
            color: cfg.positive ? "rgba(255,255,255,0.98)" : "rgba(255,255,255,0.75)",
            fontSize: 15, fontWeight: 500, fontFamily: "inherit",
            cursor: "pointer", letterSpacing: "-0.02em",
            display: "grid", placeItems: "center",
          }}
        >
          Cerrar
        </button>
      </div>
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
    insetInlineStart: 0,
    insetInlineEnd: 0,
    bottom: 0,
    display: "flex",
    gap: 28,
    justifyContent: "center",
    alignItems: "center",
    padding: "20px max(16px,env(safe-area-inset-right)) max(24px,var(--vb-safe-bottom, 0px)) max(16px,env(safe-area-inset-left))",
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
    insetInlineEnd: 0,
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
