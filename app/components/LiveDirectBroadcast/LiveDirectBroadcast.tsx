"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLiveStreamCredentials } from "@/lib/posts/post-service";

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
const WHIP_PROXY = "/api/whip-proxy";

type BroadcastStatus = "idle" | "connecting" | "live" | "error";

interface Props {
  postId: string;
  onOrientationChange?: (isPortrait: boolean) => void;
}

export default function LiveDirectBroadcast({ postId, onOrientationChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const whipResourceRef = useRef<string | null>(null);

  const [status, setStatus] = useState<BroadcastStatus>("idle");
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMedia, setHasMedia] = useState(false);

  const initCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      const vtrack = stream.getVideoTracks()[0];
      if (vtrack && onOrientationChange) {
        const s = vtrack.getSettings();
        if (s.width && s.height) {
          onOrientationChange(s.height > s.width);
        }
      }
      setHasMedia(true);
    } catch {
      setError("No se pudo acceder a la cámara o micrófono. Verifica los permisos del navegador.");
    }
  }, [onOrientationChange]);

  const startBroadcast = useCallback(async () => {
    if (!streamRef.current) return;
    setStatus("connecting");
    setError(null);
    try {
      const creds = await fetchLiveStreamCredentials(postId);
      if (!creds?.liveStreamId) {
        throw new Error("No se encontraron credenciales. Asegúrate de haber activado el live.");
      }

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      for (const track of streamRef.current.getTracks()) {
        pc.addTrack(track, streamRef.current);
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete (max 5s)
      if (pc.iceGatheringState !== "complete") {
        await new Promise<void>((resolve) => {
          const done = () => {
            if (pc.iceGatheringState === "complete") resolve();
          };
          pc.onicegatheringstatechange = done;
          setTimeout(resolve, 5000);
        });
      }

      const proxyUrl = `${WHIP_PROXY}?id=${encodeURIComponent(creds.liveStreamId)}`;
      const resp = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: pc.localDescription!.sdp,
      });

      if (!resp.ok) {
        let detail = `Error WHIP ${resp.status}`;
        try {
          const body = await resp.json();
          if (body?.error) detail += `: ${body.error}`;
          if (body?.body) detail += ` — ${body.body}`;
        } catch {
          const text = await resp.text().catch(() => "");
          if (text) detail += `: ${text}`;
        }
        throw new Error(detail);
      }

      const answerSdp = await resp.text();
      const location = resp.headers.get("X-Whip-Resource");
      if (location) whipResourceRef.current = location;

      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      setStatus("live");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al conectar.";
      setError(msg);
      setStatus("error");
      pcRef.current?.close();
      pcRef.current = null;
    }
  }, [postId]);

  const stopBroadcast = useCallback(async () => {
    if (whipResourceRef.current) {
      try {
        await fetch(`${WHIP_PROXY}?r=${encodeURIComponent(whipResourceRef.current)}`, { method: "DELETE" });
      } catch { /* best effort */ }
      whipResourceRef.current = null;
    }
    pcRef.current?.close();
    pcRef.current = null;
    setStatus("idle");
  }, []);

  const toggleMic = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !micMuted;
    stream.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMicMuted(next);
  }, [micMuted]);

  const toggleCam = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !camOff;
    stream.getVideoTracks().forEach((t) => { t.enabled = !next; });
    setCamOff(next);
  }, [camOff]);

  useEffect(() => {
    initCamera();
    return () => {
      if (whipResourceRef.current) {
        fetch(`${WHIP_PROXY}?r=${encodeURIComponent(whipResourceRef.current)}`, { method: "DELETE" }).catch(() => {});
        whipResourceRef.current = null;
      }
      pcRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isLive = status === "live";
  const isConnecting = status === "connecting";

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes ldbPulse { 0%,100%{opacity:1}50%{opacity:0.3} }
        @keyframes ldbSpin { to{transform:rotate(360deg)} }
      `}</style>

      {/* Camera preview */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "contain",
          transform: "scaleX(-1)",
          opacity: camOff ? 0.12 : 1,
          transition: "opacity 0.3s",
        }}
      />

      {/* Camera-off overlay */}
      {camOff && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.65)",
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="2" y1="2" x2="22" y2="22" />
            <path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L23 7v10" />
            <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2l10 10z" />
          </svg>
        </div>
      )}

      {/* No-media error state */}
      {!hasMedia && !error && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 2,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
        }}>
          <div style={{ width: 24, height: 24, border: "3px solid rgba(255,255,255,0.2)", borderTopColor: "#fff", borderRadius: "50%", animation: "ldbSpin 0.8s linear infinite" }} />
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", fontFamily: FONT }}>Iniciando cámara...</span>
        </div>
      )}

      {/* Status badge */}
      <div style={{
        position: "absolute", top: 12, left: 12, zIndex: 3,
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "5px 11px", borderRadius: 999,
        background: isLive
          ? "rgba(239,68,68,0.88)"
          : isConnecting
            ? "rgba(0,0,0,0.72)"
            : "rgba(0,0,0,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        fontSize: 11, fontWeight: 700, color: "#fff", fontFamily: FONT,
        letterSpacing: "0.07em",
        border: isLive ? "1px solid rgba(239,68,68,0.45)" : "1px solid rgba(255,255,255,0.1)",
      }}>
        {isLive && (
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", animation: "ldbPulse 1.4s ease-in-out infinite" }} />
        )}
        {isConnecting && (
          <span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,0.25)", borderTopColor: "#fff", borderRadius: "50%", animation: "ldbSpin 0.75s linear infinite", display: "inline-block" }} />
        )}
        {status === "idle" && "VISTA PREVIA"}
        {status === "connecting" && "CONECTANDO"}
        {status === "live" && "EN VIVO"}
        {status === "error" && "ERROR"}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          position: "absolute", top: 48, left: 12, right: 12, zIndex: 3,
          background: "rgba(127,29,29,0.92)", backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          border: "1px solid rgba(239,68,68,0.35)",
          borderRadius: 10, padding: "10px 14px",
          fontSize: 12, color: "#fca5a5", fontFamily: FONT, lineHeight: 1.4,
        }}>
          {error}
        </div>
      )}

      {/* Controls bar */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 3,
        background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, transparent 100%)",
        padding: "36px 16px 18px",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
      }}>
        {/* Mic */}
        <ControlBtn
          active={micMuted}
          disabled={!hasMedia}
          onClick={toggleMic}
          title={micMuted ? "Activar micrófono" : "Silenciar"}
        >
          {micMuted ? <MicOffIcon /> : <MicIcon />}
        </ControlBtn>

        {/* Camera */}
        <ControlBtn
          active={camOff}
          disabled={!hasMedia}
          onClick={toggleCam}
          title={camOff ? "Activar cámara" : "Apagar cámara"}
        >
          {camOff ? <CamOffIcon /> : <CamIcon />}
        </ControlBtn>

        {/* Start / Stop broadcast */}
        {(status === "idle" || status === "error") && (
          <button
            type="button"
            onClick={startBroadcast}
            disabled={!hasMedia}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "10px 22px", borderRadius: 999,
              background: hasMedia ? "rgba(239,68,68,0.95)" : "rgba(255,255,255,0.1)",
              border: "none", color: "#fff",
              fontSize: 13, fontWeight: 700, fontFamily: FONT,
              cursor: hasMedia ? "pointer" : "not-allowed",
              opacity: hasMedia ? 1 : 0.45,
              boxShadow: hasMedia ? "0 2px 12px rgba(239,68,68,0.35)" : "none",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", flexShrink: 0 }} />
            Iniciar transmisión
          </button>
        )}

        {status === "connecting" && (
          <button
            type="button"
            disabled
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "10px 22px", borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.4)",
              fontSize: 13, fontWeight: 700, fontFamily: FONT,
              cursor: "not-allowed",
            }}
          >
            Conectando...
          </button>
        )}

        {status === "live" && (
          <button
            type="button"
            onClick={stopBroadcast}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "10px 22px", borderRadius: 999,
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.45)",
              color: "#ef4444",
              fontSize: 13, fontWeight: 700, fontFamily: FONT,
              cursor: "pointer",
            }}
          >
            <span style={{ width: 8, height: 8, background: "#ef4444", borderRadius: 2, flexShrink: 0 }} />
            Detener transmisión
          </button>
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function ControlBtn({
  active, disabled, onClick, title, children,
}: {
  active: boolean; disabled?: boolean; onClick: () => void; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 44, height: 44, borderRadius: "50%",
        border: active ? "1px solid rgba(239,68,68,0.45)" : "1px solid rgba(255,255,255,0.18)",
        background: active ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.08)",
        color: active ? "#fca5a5" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        display: "grid", placeItems: "center",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
      <path d="M5 10v2a7 7 0 0 0 12 4.9" />
      <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function CamIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function CamOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L23 7v10" />
      <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2l10 10z" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
