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
  const setLiveSentRef = useRef(false);
  const cachedTokenRef = useRef<string | null>(null);

  const [status, setStatus] = useState<BroadcastStatus>("idle");
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMedia, setHasMedia] = useState(false);

  // ── Heartbeat: escribe liveData.heartbeatAt cada 20s mientras transmite ───
  useEffect(() => {
    if (status !== "live") return;

    const sendHeartbeat = async () => {
      if (!isLiveRef.current) return;
      try {
        const token = await getAuth().currentUser?.getIdToken();
        if (!token) return;
        cachedTokenRef.current = token;
        await fetch("/api/cf-broadcast", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ postId }),
        });
      } catch { /* best effort */ }
    };

    void sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 20_000);
    return () => clearInterval(interval);
  }, [status, postId]);

  // ── beforeunload: termina el live si el usuario cierra el navegador ────────
  useEffect(() => {
    const handler = () => {
      if (!isLiveRef.current || !cachedTokenRef.current) return;
      // keepalive: true asegura que la request se complete aunque la página cierre
      fetch(`/api/cf-broadcast?postId=${encodeURIComponent(postId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${cachedTokenRef.current}` },
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [postId]);

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
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
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
    setLiveSentRef.current = false;

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

      // Use raw camera track for WebRTC — canvas.captureStream() often produces no RTP packets
      // in Chrome/mobile. Viewer-side SuperComment overlays are handled via Firestore events.
      const rawVideoTrack = cameraStreamRef.current?.getVideoTracks()[0] ?? null;
      const audioTrack = micTrackRef.current;
      if (!rawVideoTrack || !audioTrack) {
        throw new Error("Tracks de cámara o micrófono no disponibles.");
      }

      // Both tracks must share the same MediaStream. If each track gets its own stream,
      // the viewer's ontrack fires twice with different streams[0], and the second call
      // (audio) overwrites video.srcObject with an audio-only stream — resulting in size:0x0.
      const localStream = new MediaStream([rawVideoTrack, audioTrack]);
      pc.addTrack(rawVideoTrack, localStream);
      pc.addTrack(audioTrack, localStream);

      // Force sendonly: WHIP is browser→CF only. Without this the SDP may be sendrecv and CF
      // answers inactive, meaning no media flows even though ICE+DTLS connect.
      for (const transceiver of pc.getTransceivers()) {
        transceiver.direction = "sendonly";
      }

      // Prefer H.264 for Cloudflare Stream — VP8/VP9 can fail to transcode to HLS
      const videoTransceiver = pc.getTransceivers().find(
        (t) => t.sender.track?.kind === "video"
      );
      if (videoTransceiver && typeof RTCRtpSender.getCapabilities === "function") {
        try {
          const caps = RTCRtpSender.getCapabilities("video");
          if (caps) {
            const h264 = caps.codecs.filter(
              (c) => c.mimeType.toLowerCase() === "video/h264"
            );
            const rest = caps.codecs.filter(
              (c) => c.mimeType.toLowerCase() !== "video/h264"
            );
            if (h264.length > 0) {
              videoTransceiver.setCodecPreferences([...h264, ...rest]);
            }
          }
        } catch {
          // setCodecPreferences not available in all browsers
        }
      }

      // Timeout: if ICE never reaches "connected" within 20s, abort
      const iceConnectTimeout = setTimeout(() => {
        if (pc.iceConnectionState !== "connected" && pc.iceConnectionState !== "completed") {
          intentionalStopRef.current = true;
          onBroadcastingChangeRef.current?.(false);
          isLiveRef.current = false;
          stopBroadcastCleanup();
          releaseTracks();
          setStatus("error");
          setError("No se pudo conectar con el servidor de video. Verifica tu conexión y vuelve a intentarlo.");
          initCamera();
        }
      }, 20000);

      pc.addEventListener("iceconnectionstatechange", () => {
        const state = pc.iceConnectionState;
        if (state === "connected" || state === "completed") {
          clearTimeout(iceConnectTimeout);
          if (!isLiveRef.current) {
            isLiveRef.current = true;
            setStatus("live"); // Show EN VIVO to creator immediately
            console.log("[LiveDirectBroadcast] ICE connected, waiting for DTLS (connectionState=connected) to mark live...");
            // Fallback: if connectionState never fires "connected" (browser edge case), mark live after 5s
            setTimeout(() => {
              if (!setLiveSentRef.current && isLiveRef.current && !intentionalStopRef.current) {
                setLiveSentRef.current = true;
                console.log("[LiveDirectBroadcast] connectionState fallback — marking live via ICE+5s");
                getAuth().currentUser?.getIdToken().then((token) => {
                  fetch("/api/cf-broadcast", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ postId, setLive: true }),
                  }).catch(() => {});
                }).catch(() => {});
              }
            }, 5000);
          }
        } else if (state === "failed" || state === "disconnected" || state === "closed") {
          clearTimeout(iceConnectTimeout);
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

      // connectionState === "connected" means BOTH ICE AND DTLS are done — media can now flow to CF.
      // Mark live in Firestore here so viewers start loading HLS when CF can actually serve segments.
      pc.addEventListener("connectionstatechange", () => {
        console.log("[LiveDirectBroadcast] connectionState:", pc.connectionState);
        if (pc.connectionState === "connected") {
          if (!setLiveSentRef.current && isLiveRef.current && !intentionalStopRef.current) {
            setLiveSentRef.current = true;
            console.log("[LiveDirectBroadcast] DTLS connected — marking live in Firestore");
            getAuth().currentUser?.getIdToken().then((token) => {
              fetch("/api/cf-broadcast", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ postId, setLive: true }),
              }).catch(() => {});
            }).catch(() => {});
          }
        } else if (pc.connectionState === "failed") {
          if (!intentionalStopRef.current) {
            onBroadcastingChangeRef.current?.(false);
            isLiveRef.current = false;
            wakeLockRef.current?.release().catch(() => {});
            wakeLockRef.current = null;
            releaseTracks();
            setStatus("error");
            setError("Conexión interrumpida. Verifica tu conexión y vuelve a intentarlo.");
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
      console.log("[LiveDirectBroadcast] SDP offer directions:", sdp.match(/a=(sendrecv|sendonly|recvonly|inactive)/g));

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
      console.log("[LiveDirectBroadcast] SDP answer directions:", sdpAnswer.match(/a=(sendrecv|sendonly|recvonly|inactive)/g));
      const whipResource = proxyResp.headers.get("X-Whip-Resource");
      if (whipResource) whipResourceRef.current = whipResource;

      await pc.setRemoteDescription({ type: "answer", sdp: sdpAnswer });
      // Status stays "connecting" until iceconnectionstatechange fires "connected"

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
      // Disable the raw camera track so viewers also see black (not just the local canvas preview)
      const rawTrack = cameraStreamRef.current?.getVideoTracks()[0];
      if (rawTrack) rawTrack.enabled = !next;
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
            width: "100%", height: "100%", objectFit: "contain",
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
            height: 36, padding: "0 16px", borderRadius: 10,
            border: "none",
            background: "#ef4444",
            color: "#fff", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", cursor: "pointer", fontFamily: FONT,
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
