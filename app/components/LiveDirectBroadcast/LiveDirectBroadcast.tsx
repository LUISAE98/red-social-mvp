"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  createLocalVideoTrack,
  createLocalAudioTrack,
  type LocalVideoTrack,
  type LocalAudioTrack,
} from "livekit-client";
import { getAuth } from "firebase/auth";

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

type BroadcastStatus = "idle" | "connecting" | "live" | "error";

interface Props {
  postId: string;
  onOrientationChange?: (isPortrait: boolean) => void;
  onBroadcastingChange?: (isBroadcasting: boolean) => void;
}

export default function LiveDirectBroadcast({ postId, onOrientationChange, onBroadcastingChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<Room | null>(null);
  const videoTrackRef = useRef<LocalVideoTrack | null>(null);
  const audioTrackRef = useRef<LocalAudioTrack | null>(null);
  const egressIdRef = useRef<string | null>(null);
  // Ref so disconnect handler always sees the latest callback without recreating the Room listener
  const onBroadcastingChangeRef = useRef(onBroadcastingChange);
  useEffect(() => { onBroadcastingChangeRef.current = onBroadcastingChange; }, [onBroadcastingChange]);

  const [status, setStatus] = useState<BroadcastStatus>("idle");
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMedia, setHasMedia] = useState(false);

  const initCamera = useCallback(async () => {
    setError(null);
    try {
      const vTrack = await createLocalVideoTrack({
        resolution: { width: 1280, height: 720, frameRate: 30 },
        facingMode: "user",
      });
      const aTrack = await createLocalAudioTrack();

      videoTrackRef.current = vTrack;
      audioTrackRef.current = aTrack;

      if (videoRef.current) {
        vTrack.attach(videoRef.current);
      }

      const settings = vTrack.mediaStreamTrack.getSettings();
      if (settings.width && settings.height && onOrientationChange) {
        onOrientationChange(settings.height > settings.width);
      }

      setHasMedia(true);
    } catch {
      setError("No se pudo acceder a la cámara o micrófono. Verifica los permisos del navegador.");
    }
  }, [onOrientationChange]);

  useEffect(() => {
    initCamera();
    return () => {
      videoTrackRef.current?.stop();
      audioTrackRef.current?.stop();
      roomRef.current?.disconnect();
    };
  }, [initCamera]);

  const startBroadcast = useCallback(async () => {
    if (!videoTrackRef.current || !audioTrackRef.current) return;
    setStatus("connecting");
    setError(null);

    try {
      // Get Firebase ID token for auth
      const currentUser = getAuth().currentUser;
      if (!currentUser) throw new Error("Debes iniciar sesión para transmitir.");
      const idToken = await currentUser.getIdToken();

      // Start broadcast — API creates Egress → Mux + returns LiveKit token
      const resp = await fetch("/api/livekit-broadcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ postId }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.error ?? `Error ${resp.status} al iniciar transmisión`);
      }

      const { token, roomName, egressId, livekitUrl } = await resp.json();
      egressIdRef.current = egressId;

      // Connect to LiveKit room
      const room = new Room({
        adaptiveStream: false,
        dynacast: true,
      });
      roomRef.current = room;

      room.on(RoomEvent.Disconnected, () => {
        setStatus("idle");
        onBroadcastingChangeRef.current?.(false);
        // Stop egress if it's still active (e.g. unexpected disconnect)
        if (egressIdRef.current) {
          stopEgress(egressIdRef.current);
          egressIdRef.current = null;
        }
      });

      await room.connect(livekitUrl, token, { autoSubscribe: false });

      // Publish tracks
      await room.localParticipant.publishTrack(videoTrackRef.current, {
        source: Track.Source.Camera,
        simulcast: false,
      });
      await room.localParticipant.publishTrack(audioTrackRef.current, {
        source: Track.Source.Microphone,
      });

      setStatus("live");
      onBroadcastingChange?.(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido al iniciar";
      setError(msg);
      setStatus("error");
      // Clean up egress if it was started
      if (egressIdRef.current) {
        stopEgress(egressIdRef.current);
        egressIdRef.current = null;
      }
    }
  }, [postId]);

  const stopEgress = async (egressId: string) => {
    try {
      const currentUser = getAuth().currentUser;
      if (!currentUser) return;
      const idToken = await currentUser.getIdToken();
      await fetch(`/api/livekit-broadcast?egressId=${encodeURIComponent(egressId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}` },
      });
    } catch {
      // best effort
    }
  };

  const stopBroadcast = useCallback(async () => {
    const room = roomRef.current;
    if (room) {
      await room.disconnect();
      roomRef.current = null;
    }
    if (egressIdRef.current) {
      await stopEgress(egressIdRef.current);
      egressIdRef.current = null;
    }
    setStatus("idle");
    onBroadcastingChange?.(false);
  }, [onBroadcastingChange]);

  const toggleMic = useCallback(() => {
    const track = audioTrackRef.current;
    if (!track) return;
    if (micMuted) {
      track.unmute();
    } else {
      track.mute();
    }
    setMicMuted((p) => !p);

    // If in room, also mute the published track
    const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (pub) {
      micMuted ? pub.unmute() : pub.mute();
    }
  }, [micMuted]);

  const toggleCam = useCallback(() => {
    const track = videoTrackRef.current;
    if (!track) return;
    if (camOff) {
      track.unmute();
    } else {
      track.mute();
    }
    setCamOff((p) => !p);

    const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
    if (pub) {
      camOff ? pub.unmute() : pub.mute();
    }
  }, [camOff]);

  const statusLabel =
    status === "live" ? "EN VIVO" : status === "connecting" ? "CONECTANDO..." : "VISTA PREVIA";
  const statusColor =
    status === "live" ? "#ef4444" : status === "connecting" ? "#f59e0b" : "#6b7280";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#000",
        borderRadius: 12,
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT,
      }}
    >
      {/* Camera preview */}
      <div style={{ flex: 1, position: "relative", background: "#111", minHeight: 0 }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)",
            display: hasMedia ? "block" : "none",
          }}
        />
        {!hasMedia && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#6b7280",
              fontSize: 14,
            }}
          >
            Iniciando cámara…
          </div>
        )}

        {/* Status badge */}
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            background: "rgba(0,0,0,0.7)",
            border: `1px solid ${statusColor}`,
            borderRadius: 6,
            padding: "3px 10px",
            fontSize: 11,
            fontWeight: 700,
            color: statusColor,
            letterSpacing: "0.08em",
          }}
        >
          {statusLabel}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "8px 14px",
            background: "rgba(239,68,68,0.12)",
            borderTop: "1px solid rgba(239,68,68,0.3)",
            color: "#fca5a5",
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}

      {/* Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "rgba(0,0,0,0.85)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* Mic */}
        <button
          type="button"
          onClick={toggleMic}
          disabled={!hasMedia}
          title={micMuted ? "Activar micrófono" : "Silenciar micrófono"}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            border: micMuted ? "1px solid rgba(239,68,68,0.5)" : "1px solid rgba(255,255,255,0.15)",
            background: micMuted ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.07)",
            color: micMuted ? "#ef4444" : "#fff",
            cursor: hasMedia ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: hasMedia ? 1 : 0.4,
          }}
        >
          {micMuted ? (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          ) : (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>

        {/* Camera */}
        <button
          type="button"
          onClick={toggleCam}
          disabled={!hasMedia}
          title={camOff ? "Activar cámara" : "Apagar cámara"}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            border: camOff ? "1px solid rgba(239,68,68,0.5)" : "1px solid rgba(255,255,255,0.15)",
            background: camOff ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.07)",
            color: camOff ? "#ef4444" : "#fff",
            cursor: hasMedia ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: hasMedia ? 1 : 0.4,
          }}
        >
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
        </button>

        <div style={{ flex: 1 }} />

        {/* Start / Stop */}
        {status === "live" ? (
          <button
            type="button"
            onClick={stopBroadcast}
            style={{
              height: 36,
              padding: "0 16px",
              borderRadius: 8,
              border: "1px solid rgba(239,68,68,0.5)",
              background: "rgba(239,68,68,0.15)",
              color: "#ef4444",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            Detener transmisión
          </button>
        ) : (
          <button
            type="button"
            onClick={startBroadcast}
            disabled={!hasMedia || status === "connecting"}
            style={{
              height: 36,
              padding: "0 16px",
              borderRadius: 8,
              border: "none",
              background:
                !hasMedia || status === "connecting"
                  ? "rgba(255,255,255,0.1)"
                  : "linear-gradient(135deg, #7c3aed, #a855f7)",
              color: !hasMedia || status === "connecting" ? "#6b7280" : "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: !hasMedia || status === "connecting" ? "not-allowed" : "pointer",
              fontFamily: FONT,
            }}
          >
            {status === "connecting" ? "Conectando…" : "Iniciar transmisión"}
          </button>
        )}
      </div>
    </div>
  );
}
