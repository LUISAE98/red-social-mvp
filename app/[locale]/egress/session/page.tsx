"use client";

// Plantilla de grabación (LiveKit Room Composite Egress) para sesiones 1-a-1.
//
// El grabador headless de LiveKit abre esta página con ?url=&token=&layout= en
// la URL, se conecta a la sala como participante oculto y graba justo lo que
// esta página renderiza. Layout FIJO: el creador siempre en grande a pantalla
// completa y el comprador como PiP pequeño en la esquina — como lo ve el fan.
//
// El creador se identifica por el prefijo de identidad `creator_` / `buyer_`
// que asigna getLivekitToken en el backend.
//
// Solo se prueba en producción (Vercel): el grabador vive en la nube y necesita
// abrir esta URL pública; no alcanza localhost.

import { useEffect, useMemo, useState } from "react";
import { Room, Track } from "livekit-client";
import EgressHelper from "@livekit/egress-sdk";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useTracks,
  useParticipants,
} from "@livekit/components-react";

const TYPE_LABEL: Record<string, string> = {
  meet_greet: "Tiempo contigo",
  exclusive_session: "Sesión exclusiva",
};

// Overlay "horneado": avatar del creador con aro de Vibra + nombre + tipo de
// experiencia, arriba a la izquierda. Se renderiza a 1080p nativo (nítido) y el
// grabador lo captura dentro del video. (Sin marca de vibraon.com.)
function OverlayBadge({
  avatarUrl,
  name,
  type,
}: {
  avatarUrl: string | null;
  name: string;
  type: string;
}) {
  const typeLabel = TYPE_LABEL[type] ?? "";
  const initials = (name || "?").trim().charAt(0).toUpperCase();
  const AVATAR = 104;
  const RING = 7;
  return (
    <div style={{ position: "absolute", top: 34, left: 34, display: "flex", alignItems: "center", gap: 16, zIndex: 20 }}>
      <div
        style={{
          width: AVATAR + RING * 2,
          height: AVATAR + RING * 2,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)",
          padding: RING,
          boxSizing: "border-box",
          flexShrink: 0,
          boxShadow: "0 4px 18px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            overflow: "hidden",
            background: "#1a1a1a",
            border: "2px solid #000",
            boxSizing: "border-box",
            display: "grid",
            placeItems: "center",
          }}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span style={{ color: "#fff", fontWeight: 700, fontSize: Math.round(AVATAR * 0.4) }}>{initials}</span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 37, letterSpacing: "-0.01em", textShadow: "0 2px 10px rgba(0,0,0,0.7)", lineHeight: 1.1 }}>
          {name}
        </span>
        {typeLabel ? (
          <span style={{ color: "rgba(255,255,255,0.88)", fontWeight: 500, fontSize: 27, textShadow: "0 2px 10px rgba(0,0,0,0.7)", lineHeight: 1.1 }}>
            {typeLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CreatorFocusLayout() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const participants = useParticipants();
  const creator = tracks.find((t) => t.participant.identity.startsWith("creator_"));
  const buyer = tracks.find((t) => t.participant.identity.startsWith("buyer_"));

  // Datos del overlay desde la metadata del token del creador.
  const creatorP = participants.find((p) => p.identity.startsWith("creator_"));
  let overlay: { avatarUrl: string | null; name: string; type: string } | null = null;
  if (creatorP?.metadata) {
    try {
      const m = JSON.parse(creatorP.metadata) as { avatarUrl?: string | null; name?: string; type?: string };
      overlay = { avatarUrl: m.avatarUrl ?? null, name: m.name ?? creatorP.name ?? "", type: m.type ?? "" };
    } catch { /* metadata inválida — sin overlay */ }
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000" }}>
      {/* Creador — siempre grande, llena el cuadro */}
      {creator ? (
        <VideoTrack
          trackRef={creator}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : null}

      {/* Comprador — PiP pequeño en la esquina inferior derecha */}
      {buyer ? (
        <div
          style={{
            position: "absolute",
            right: "2.5%",
            bottom: "4%",
            width: "24%",
            aspectRatio: "16 / 9",
            borderRadius: 12,
            overflow: "hidden",
            border: "2px solid rgba(255,255,255,0.85)",
            background: "#111",
            boxShadow: "0 6px 24px rgba(0,0,0,0.55)",
          }}
        >
          <VideoTrack
            trackRef={buyer}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ) : null}

      {/* Overlay horneado (avatar + aro + nombre + tipo) */}
      {overlay ? <OverlayBadge avatarUrl={overlay.avatarUrl} name={overlay.name} type={overlay.type} /> : null}
    </div>
  );
}

export default function EgressSessionPage() {
  const room = useMemo(
    () => new Room({ adaptiveStream: false, dynacast: false }),
    []
  );
  const [conn, setConn] = useState<{ url: string; token: string } | null>(null);

  useEffect(() => {
    // Estos params solo existen cuando llega el grabador de LiveKit.
    const url = EgressHelper.getLiveKitURL();
    const token = EgressHelper.getAccessToken();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (url && token) setConn({ url, token });
  }, []);

  // Cubre todo el chrome del layout raíz para que la grabación salga limpia.
  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2147483646,
    background: "#000",
  };

  return (
    <>
      <style>{`
        #desktop-refresh-splash { display: none !important; }
        html, body { background: #000 !important; }
      `}</style>

      {conn ? (
        <LiveKitRoom
          room={room}
          serverUrl={conn.url}
          token={conn.token}
          connect
          audio={false}
          video={false}
          onConnected={() => {
            EgressHelper.setRoom(room);
            EgressHelper.startRecording();
          }}
          style={overlayStyle}
        >
          <CreatorFocusLayout />
          <RoomAudioRenderer />
        </LiveKitRoom>
      ) : (
        <div style={overlayStyle} />
      )}
    </>
  );
}
