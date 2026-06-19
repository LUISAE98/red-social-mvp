"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  LocalVideoTrack,
  type LocalAudioTrack,
} from "livekit-client";
import { getAuth } from "firebase/auth";
import type { SuperComment } from "@/lib/liveChat/types";

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
const CANVAS_FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

type BroadcastStatus = "idle" | "connecting" | "live" | "error";

interface Props {
  postId: string;
  onOrientationChange?: (isPortrait: boolean) => void;
  onBroadcastingChange?: (isBroadcasting: boolean) => void;
  activeSuperOverlay?: SuperComment | null;
}

export default function LiveDirectBroadcast({
  postId,
  onOrientationChange,
  onBroadcastingChange,
  activeSuperOverlay,
}: Props) {
  // Hidden video element — receives raw camera stream for canvas drawing
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  // Canvas — composites camera + overlay; previewed to creator and streamed to Mux
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const roomRef = useRef<Room | null>(null);
  const videoTrackRef = useRef<LocalVideoTrack | null>(null);
  const audioTrackRef = useRef<LocalAudioTrack | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const egressIdRef = useRef<string | null>(null);

  const onBroadcastingChangeRef = useRef(onBroadcastingChange);
  useEffect(() => { onBroadcastingChangeRef.current = onBroadcastingChange; }, [onBroadcastingChange]);

  // Sync activeSuperOverlay to a ref so the RAF closure always has the latest value
  const activeSuperOverlayRef = useRef<SuperComment | null>(null);
  useEffect(() => {
    activeSuperOverlayRef.current = activeSuperOverlay ?? null;
  }, [activeSuperOverlay]);

  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  const initCameraRef = useRef<() => Promise<void>>(async () => {});

  const [status, setStatus] = useState<BroadcastStatus>("idle");
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMedia, setHasMedia] = useState(false);
  const isPortraitRef = useRef(false);
  const intentionalStopRef = useRef(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const isLiveRef = useRef(false);

  // ── Canvas compositing loop ────────────────────────────────────────────────
  const startDrawLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const video = hiddenVideoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;

      // Draw camera frame (not mirrored — correct orientation for viewers)
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, W, H);
      } else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
      }

      // Draw super comment overlay if active
      const sc = activeSuperOverlayRef.current;
      if (sc) {
        drawSuperCommentOverlay(ctx, sc, W, H);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  const stopDrawLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // ── Camera init ────────────────────────────────────────────────────────────
  const initCamera = useCallback(async () => {
    setError(null);
    try {
      // Request 4K (3840×2160) and let the browser/device fall back gracefully
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: 30, min: 15 },
          facingMode: "user",
        },
        audio: false,
      });
      cameraStreamRef.current = stream;

      const video = hiddenVideoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {}); // autoplay policy: may need user gesture
      }

      // Size canvas to actual camera resolution
      const vTrack = stream.getVideoTracks()[0];
      const settings = vTrack.getSettings();
      const W = settings.width ?? 1920;
      const H = settings.height ?? 1080;

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = W;
        canvas.height = H;
      }

      // Capture canvas as MediaStream → will be published to LiveKit/Mux
      const canvasStream = canvas!.captureStream(30);
      canvasStreamRef.current = canvasStream;

      const canvasVideoTrack = canvasStream.getVideoTracks()[0];
      // userProvidedTrack: true — LiveKit must not try to restart/replace this track
      videoTrackRef.current = new LocalVideoTrack(canvasVideoTrack, undefined, true);

      // Audio track (separate from camera getUserMedia for cross-browser compatibility)
      const aTrack = await createLocalAudioTrack();
      audioTrackRef.current = aTrack;

      startDrawLoop();

      const portrait = typeof window !== "undefined" ? window.innerHeight > window.innerWidth : false;
      isPortraitRef.current = portrait;
      if (onOrientationChange) onOrientationChange(portrait);

      setHasMedia(true);
    } catch {
      setError("No se pudo acceder a la cámara o micrófono. Verifica los permisos del navegador.");
    }
  }, [onOrientationChange, startDrawLoop]);

  useEffect(() => { initCameraRef.current = initCamera; }, [initCamera]);

  const releaseCameraTracks = useCallback(() => {
    stopDrawLoop();

    // Stop canvas stream tracks
    canvasStreamRef.current?.getTracks().forEach((t) => t.stop());
    canvasStreamRef.current = null;

    // Stop camera stream tracks and clear video srcObject
    const video = hiddenVideoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;

    videoTrackRef.current?.stop();
    audioTrackRef.current?.stop();
    videoTrackRef.current = null;
    audioTrackRef.current = null;
    setHasMedia(false);
  }, [stopDrawLoop]);

  useEffect(() => {
    initCamera();
    return () => {
      stopDrawLoop();
      const video = hiddenVideoRef.current;
      if (video?.srcObject) {
        (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      }
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      canvasStreamRef.current?.getTracks().forEach((t) => t.stop());
      videoTrackRef.current?.stop();
      audioTrackRef.current?.stop();
      // Al desmontar: si el egress sigue activo, pararlo explícitamente antes de
      // desconectar la sala para que Mux no quede en estado indefinido.
      if (egressIdRef.current) {
        intentionalStopRef.current = true;
        stopEgress(egressIdRef.current);
        egressIdRef.current = null;
      }
      roomRef.current?.disconnect();
    };
  }, [initCamera, stopDrawLoop]);

  useEffect(() => {
    const updateOrientation = () => {
      if (isLiveRef.current) return;
      const portrait = window.innerHeight > window.innerWidth;
      isPortraitRef.current = portrait;
      onOrientationChange?.(portrait);
    };
    window.addEventListener("resize", updateOrientation);
    return () => window.removeEventListener("resize", updateOrientation);
  }, [onOrientationChange]);

  // ── Broadcast control ──────────────────────────────────────────────────────
  const startBroadcast = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    intentionalStopRef.current = false;

    if (!videoTrackRef.current || !audioTrackRef.current) {
      await initCamera();
      if (!videoTrackRef.current || !audioTrackRef.current) {
        setStatus("error");
        return;
      }
    }

    const currentPortrait = typeof window !== "undefined" ? window.innerHeight > window.innerWidth : false;
    isPortraitRef.current = currentPortrait;
    onOrientationChange?.(currentPortrait);
    onBroadcastingChange?.(true);

    try {
      const currentUser = getAuth().currentUser;
      if (!currentUser) throw new Error("Debes iniciar sesión para transmitir.");
      const idToken = await currentUser.getIdToken();

      const resp = await fetch("/api/livekit-broadcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ postId, isPortrait: isPortraitRef.current }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.error ?? `Error ${resp.status} al iniciar transmisión`);
      }

      const { token, egressId, livekitUrl } = await resp.json();
      egressIdRef.current = egressId;

      const room = new Room({
        adaptiveStream: false,
        dynacast: true,
        disconnectOnPageLeave: false,
      });
      roomRef.current = room;

      room.on(RoomEvent.Reconnecting, () => setStatus("connecting"));
      room.on(RoomEvent.Reconnected, () => setStatus("live"));

      room.on(RoomEvent.Disconnected, () => {
        const wasIntentional = intentionalStopRef.current;
        intentionalStopRef.current = false;
        onBroadcastingChangeRef.current?.(false);
        isLiveRef.current = false;
        wakeLockRef.current?.release().catch(() => {});
        wakeLockRef.current = null;
        try { (screen.orientation as unknown as { unlock?: () => void }).unlock?.(); } catch { /* not supported */ }

        if (wasIntentional) {
          setStatus("idle");
        } else {
          // No detener el egress — el stream de Mux sigue vivo para los espectadores.
          // El creador puede reconectarse y retomar la transmisión.
          releaseCameraTracks();
          setStatus("error");
          setError("Conexión interrumpida. Puedes reconectar para continuar el live.");
          initCameraRef.current();
        }
      });

      await room.connect(livekitUrl, token, { autoSubscribe: false });

      await room.localParticipant.publishTrack(videoTrackRef.current, {
        source: Track.Source.Camera,
        simulcast: false,
      });
      await room.localParticipant.publishTrack(audioTrackRef.current, {
        source: Track.Source.Microphone,
      });

      setStatus("live");
      isLiveRef.current = true;

      try {
        if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        }
      } catch { /* Wake Lock not supported — non-critical */ }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (screen.orientation as any).lock?.(currentPortrait ? "portrait" : "landscape");
      } catch { /* not supported on iOS */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido al iniciar";
      setError(msg);
      setStatus("error");
      onBroadcastingChange?.(false);
      if (egressIdRef.current) {
        stopEgress(egressIdRef.current);
        egressIdRef.current = null;
      }
    }
  }, [postId, onBroadcastingChange, initCamera, releaseCameraTracks, onOrientationChange]);

  const stopEgress = async (egressId: string) => {
    try {
      const currentUser = getAuth().currentUser;
      if (!currentUser) return;
      const idToken = await currentUser.getIdToken();
      await fetch(
        `/api/livekit-broadcast?egressId=${encodeURIComponent(egressId)}&postId=${encodeURIComponent(postId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } },
      );
    } catch { /* best effort */ }
  };

  const stopBroadcast = useCallback(async () => {
    intentionalStopRef.current = true;
    isLiveRef.current = false;

    try { await wakeLockRef.current?.release(); } catch {}
    wakeLockRef.current = null;
    try { screen.orientation.unlock(); } catch { /* not supported on iOS */ }

    if (egressIdRef.current) {
      await stopEgress(egressIdRef.current);
      egressIdRef.current = null;
    }

    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try { await room.disconnect(); } catch { /* best effort */ }
    }

    releaseCameraTracks();
    setStatus("idle");
    onBroadcastingChange?.(false);
  }, [onBroadcastingChange, releaseCameraTracks]);

  const toggleMic = useCallback(() => {
    const track = audioTrackRef.current;
    if (!track) return;
    if (micMuted) track.unmute(); else track.mute();
    setMicMuted((p) => !p);
    const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (pub) { micMuted ? pub.unmute() : pub.mute(); }
  }, [micMuted]);

  const toggleCam = useCallback(() => {
    setCamOff((prev) => {
      const next = !prev;
      // Mute/unmute at the published track level — canvas keeps drawing locally
      const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
      if (pub) { next ? pub.mute() : pub.unmute(); }
      return next;
    });
  }, []);

  const statusLabel =
    status === "live" ? "EN VIVO" :
    status === "connecting" ? "CONECTANDO..." :
    "VISTA PREVIA";
  const statusColor =
    status === "live" ? "#ef4444" : status === "connecting" ? "#f59e0b" : "#6b7280";

  return (
    <div style={{
      width: "100%", height: "100%", background: "#000",
      borderRadius: 12, overflow: "hidden", position: "relative",
      display: "flex", flexDirection: "column", fontFamily: FONT,
    }}>
      {/* Hidden video — camera source for canvas */}
      <video
        ref={hiddenVideoRef}
        autoPlay
        muted
        playsInline
        style={{ display: "none" }}
      />

      {/* Canvas preview — mirrored for creator (CSS only; stream is not mirrored) */}
      <div style={{ flex: 1, position: "relative", background: "#111", minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)",
            display: hasMedia ? "block" : "none",
          }}
        />
        {!hasMedia && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#6b7280", fontSize: 14,
          }}>
            Iniciando cámara…
          </div>
        )}

        {/* Status badge */}
        <div style={{
          position: "absolute", top: 12, left: 12,
          background: "rgba(0,0,0,0.7)",
          border: `1px solid ${statusColor}`,
          borderRadius: 6, padding: "3px 10px",
          fontSize: 11, fontWeight: 700, color: statusColor, letterSpacing: "0.08em",
        }}>
          {statusLabel}
        </div>
      </div>

      {error && (
        <div style={{
          padding: "8px 14px",
          background: "rgba(239,68,68,0.12)",
          borderTop: "1px solid rgba(239,68,68,0.3)",
          color: "#fca5a5", fontSize: 12, lineHeight: 1.4,
        }}>
          {error}
        </div>
      )}

      {/* Controls */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 12px",
        background: "rgba(0,0,0,0.85)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
      }}>
        {/* Mic */}
        <ControlBtn onClick={toggleMic} disabled={!hasMedia} active={micMuted} title={micMuted ? "Activar micrófono" : "Silenciar micrófono"}>
          {micMuted ? (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
              <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          ) : (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </ControlBtn>

        {/* Cam */}
        <ControlBtn onClick={toggleCam} disabled={!hasMedia} active={camOff} title={camOff ? "Activar cámara" : "Apagar cámara"}>
          {camOff ? (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          )}
        </ControlBtn>

        <div style={{ flex: 1 }} />

        {status === "live" ? (
          <button type="button" onClick={stopBroadcast} style={{
            height: 36, padding: "0 16px", borderRadius: 8,
            border: "1px solid rgba(239,68,68,0.5)",
            background: "rgba(239,68,68,0.15)",
            color: "#ef4444", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
          }}>
            Detener transmisión
          </button>
        ) : (
          <button type="button" onClick={startBroadcast} disabled={status === "connecting" || !hasMedia} style={{
            height: 36, padding: "0 16px", borderRadius: 8, border: "none",
            background: (status === "connecting" || !hasMedia) ? "rgba(255,255,255,0.1)"
              : "linear-gradient(135deg, #7c3aed, #a855f7)",
            color: (status === "connecting" || !hasMedia) ? "#6b7280" : "#fff",
            fontSize: 13, fontWeight: 600,
            cursor: (status === "connecting" || !hasMedia) ? "not-allowed" : "pointer",
            fontFamily: FONT,
          }}>
            {status === "connecting" ? "Conectando…" : "Iniciar transmisión"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Canvas overlay drawing ─────────────────────────────────────────────────

function drawSuperCommentOverlay(
  ctx: CanvasRenderingContext2D,
  sc: SuperComment,
  W: number,
  H: number,
) {
  const scale = H / 1080;
  const panelH = Math.round(150 * scale);
  const padX = Math.round(28 * scale);
  const barW = Math.round(6 * scale);
  const y = H - panelH;

  ctx.save();

  // Dark background panel
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, y, W, panelH);
  ctx.globalAlpha = 1;

  // Left color bar
  ctx.fillStyle = sc.color;
  ctx.fillRect(0, y, barW, panelH);

  // Subtle top border line in tier color
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = sc.color;
  ctx.fillRect(0, y, W, Math.round(2 * scale));
  ctx.globalAlpha = 1;

  const rowY1 = y + Math.round(20 * scale);
  const rowY2 = y + Math.round(62 * scale);

  // Row 1: tier badge + amount + username
  const badgeFontSize = Math.round(18 * scale);
  ctx.font = `700 ${badgeFontSize}px ${CANVAS_FONT}`;
  ctx.textBaseline = "top";

  // Tier name (colored)
  ctx.fillStyle = sc.color;
  ctx.fillText(sc.tierName, padX + barW, rowY1);
  const tierW = ctx.measureText(sc.tierName).width;

  // Separator + amount + username (muted)
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  const meta = `  ·  $${sc.amount} MXN  ·  ${sc.username}`;
  ctx.fillText(meta, padX + barW + tierW, rowY1);

  // Row 2: comment text (white, larger)
  const textFontSize = Math.round(30 * scale);
  ctx.font = `500 ${textFontSize}px ${CANVAS_FONT}`;
  ctx.fillStyle = "#ffffff";
  const maxTextW = W - (padX + barW) * 2;
  wrapText(ctx, sc.text, padX + barW, rowY2, maxTextW, Math.round(38 * scale), 2);

  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(" ");
  let line = "";
  let linesDrawn = 0;

  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + " ";
    if (ctx.measureText(testLine).width > maxWidth && line !== "") {
      if (linesDrawn >= maxLines - 1) {
        // Last allowed line — truncate with ellipsis
        let truncated = line.trimEnd();
        while (truncated.length > 0 && ctx.measureText(truncated + "…").width > maxWidth) {
          truncated = truncated.slice(0, -1);
        }
        ctx.fillText(truncated + "…", x, y);
        return;
      }
      ctx.fillText(line.trimEnd(), x, y);
      line = words[i] + " ";
      y += lineHeight;
      linesDrawn++;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trimEnd(), x, y);
}

// ── Sub-component ──────────────────────────────────────────────────────────

function ControlBtn({
  onClick, disabled, active, title, children,
}: {
  onClick: () => void;
  disabled: boolean;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 36, height: 36, borderRadius: 8,
        border: active ? "1px solid rgba(239,68,68,0.5)" : "1px solid rgba(255,255,255,0.15)",
        background: active ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.07)",
        color: active ? "#ef4444" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}
