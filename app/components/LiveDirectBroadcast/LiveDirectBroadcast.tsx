"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAuth } from "firebase/auth";
import type { SuperComment } from "@/lib/liveChat/types";

const FONT = "inherit";
const CANVAS_FONT = "inherit";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];

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
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const whipResourceRef = useRef<string | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const canvasVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const onBroadcastingChangeRef = useRef(onBroadcastingChange);
  useEffect(() => { onBroadcastingChangeRef.current = onBroadcastingChange; }, [onBroadcastingChange]);

  const activeSuperOverlayRef = useRef<SuperComment | null>(null);
  useEffect(() => { activeSuperOverlayRef.current = activeSuperOverlay ?? null; }, [activeSuperOverlay]);

  const camOffRef = useRef(false);
  const intentionalStopRef = useRef(false);
  const isLiveRef = useRef(false);
  const isPortraitRef = useRef(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const [status, setStatus] = useState<BroadcastStatus>("idle");
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMedia, setHasMedia] = useState(false);

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

      if (camOffRef.current) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
      } else if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, W, H);
      } else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
      }

      const sc = activeSuperOverlayRef.current;
      if (sc) drawSuperCommentOverlay(ctx, sc, W, H);

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
        await video.play().catch(() => {});
      }

      const vTrack = stream.getVideoTracks()[0];
      const settings = vTrack.getSettings();
      const W = settings.width ?? 1920;
      const H = settings.height ?? 1080;

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = W;
        canvas.height = H;
      }

      const canvasStream = canvas!.captureStream(30);
      canvasStreamRef.current = canvasStream;
      canvasVideoTrackRef.current = canvasStream.getVideoTracks()[0];

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micTrackRef.current = micStream.getAudioTracks()[0];

      startDrawLoop();

      const portrait = typeof window !== "undefined" ? window.innerHeight > window.innerWidth : false;
      isPortraitRef.current = portrait;
      if (onOrientationChange) onOrientationChange(portrait);

      setHasMedia(true);
    } catch {
      setError("No se pudo acceder a la cámara o micrófono. Verifica los permisos del navegador.");
    }
  }, [onOrientationChange, startDrawLoop]);

  const releaseTracks = useCallback(() => {
    stopDrawLoop();
    canvasStreamRef.current?.getTracks().forEach((t) => t.stop());
    canvasStreamRef.current = null;
    canvasVideoTrackRef.current = null;

    const video = hiddenVideoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;

    micTrackRef.current?.stop();
    micTrackRef.current = null;
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
      micTrackRef.current?.stop();
      // Best-effort stop if unmounted while live
      if (pcRef.current) {
        intentionalStopRef.current = true;
        stopBroadcastCleanup();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── WHIP helpers ───────────────────────────────────────────────────────────
  async function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 5000): Promise<void> {
    if (pc.iceGatheringState === "complete") return;
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      const handler = () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(timer);
          pc.removeEventListener("icegatheringstatechange", handler);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", handler);
    });
  }

  async function stopBroadcastCleanup() {
    const pc = pcRef.current;
    pcRef.current = null;

    if (whipResourceRef.current) {
      const resource = encodeURIComponent(whipResourceRef.current);
      fetch(`/api/whip-proxy?r=${resource}`, { method: "DELETE" }).catch(() => {});
      whipResourceRef.current = null;
    }

    if (pc) {
      try { pc.close(); } catch { /* best effort */ }
    }
  }

  // ── Broadcast control ──────────────────────────────────────────────────────
  const startBroadcast = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    intentionalStopRef.current = false;

    if (!canvasVideoTrackRef.current || !micTrackRef.current) {
      await initCamera();
      if (!canvasVideoTrackRef.current || !micTrackRef.current) {
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

      // Notify server to set activeLivePostId immediately (live ring appears)
      const startResp = await fetch("/api/cf-broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ postId }),
      });
      if (!startResp.ok) {
        const d = await startResp.json().catch(() => ({}));
        throw new Error(d?.error ?? `Error ${startResp.status} al iniciar transmisión`);
      }

      // Build RTCPeerConnection
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      const videoTrack = canvasVideoTrackRef.current!;
      const audioTrack = micTrackRef.current!;

      const videoStream = new MediaStream([videoTrack]);
      const audioStream = new MediaStream([audioTrack]);
      pc.addTrack(videoTrack, videoStream);
      pc.addTrack(audioTrack, audioStream);

      pc.addEventListener("iceconnectionstatechange", () => {
        const state = pc.iceConnectionState;
        if (state === "failed" || state === "disconnected" || state === "closed") {
          if (!intentionalStopRef.current) {
            onBroadcastingChangeRef.current?.(false);
            isLiveRef.current = false;
            wakeLockRef.current?.release().catch(() => {});
            wakeLockRef.current = null;
            releaseTracks();
            setStatus("error");
            setError("Conexión interrumpida. Puedes reconectar para continuar el live.");
            initCamera();
          }
        }
      });

      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      const sdp = pc.localDescription?.sdp;
      if (!sdp) throw new Error("No se pudo generar la oferta SDP.");

      const proxyResp = await fetch(`/api/whip-proxy?postId=${encodeURIComponent(postId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
          Authorization: `Bearer ${idToken}`,
        },
        body: sdp,
      });

      if (!proxyResp.ok) {
        const d = await proxyResp.json().catch(() => ({}));
        throw new Error(d?.error ?? `Error ${proxyResp.status} al conectar con Cloudflare`);
      }

      const sdpAnswer = await proxyResp.text();
      const whipResource = proxyResp.headers.get("X-Whip-Resource");
      if (whipResource) whipResourceRef.current = whipResource;

      await pc.setRemoteDescription({ type: "answer", sdp: sdpAnswer });

      setStatus("live");
      isLiveRef.current = true;

      try {
        if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        }
      } catch { /* non-critical */ }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (screen.orientation as any).lock?.(currentPortrait ? "portrait" : "landscape");
      } catch { /* not supported on iOS */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido al iniciar";
      setError(msg);
      setStatus("error");
      onBroadcastingChange?.(false);
      await stopBroadcastCleanup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, onBroadcastingChange, initCamera, releaseTracks, onOrientationChange]);

  const stopBroadcast = useCallback(async () => {
    intentionalStopRef.current = true;
    isLiveRef.current = false;

    try { await wakeLockRef.current?.release(); } catch {}
    wakeLockRef.current = null;
    try { screen.orientation.unlock(); } catch { /* not supported on iOS */ }

    // Notify server to mark live as ended and clear live rings
    try {
      const currentUser = getAuth().currentUser;
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        await fetch(`/api/cf-broadcast?postId=${encodeURIComponent(postId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${idToken}` },
        });
      }
    } catch { /* best effort */ }

    await stopBroadcastCleanup();
    releaseTracks();
    setStatus("idle");
    onBroadcastingChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, onBroadcastingChange, releaseTracks]);

  const toggleMic = useCallback(() => {
    const track = micTrackRef.current;
    if (!track) return;
    const newMuted = !micMuted;
    track.enabled = !newMuted;
    setMicMuted(newMuted);
  }, [micMuted]);

  const toggleCam = useCallback(() => {
    setCamOff((prev) => {
      const next = !prev;
      camOffRef.current = next;
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
      <video ref={hiddenVideoRef} autoPlay muted playsInline style={{ display: "none" }} />

      <div style={{ flex: 1, position: "relative", background: "#111", minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{
            width: "100%", height: "100%", objectFit: "cover",
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

      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 12px",
        background: "rgba(0,0,0,0.85)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
      }}>
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

  ctx.globalAlpha = 0.88;
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, y, W, panelH);
  ctx.globalAlpha = 1;

  ctx.fillStyle = sc.color;
  ctx.fillRect(0, y, barW, panelH);

  ctx.globalAlpha = 0.5;
  ctx.fillStyle = sc.color;
  ctx.fillRect(0, y, W, Math.round(2 * scale));
  ctx.globalAlpha = 1;

  const rowY1 = y + Math.round(20 * scale);
  const rowY2 = y + Math.round(62 * scale);

  const badgeFontSize = Math.round(18 * scale);
  ctx.font = `700 ${badgeFontSize}px ${CANVAS_FONT}`;
  ctx.textBaseline = "top";

  ctx.fillStyle = sc.color;
  ctx.fillText(sc.tierName, padX + barW, rowY1);
  const tierW = ctx.measureText(sc.tierName).width;

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  const meta = `  ·  $${sc.amount} MXN  ·  ${sc.username}`;
  ctx.fillText(meta, padX + barW + tierW, rowY1);

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
