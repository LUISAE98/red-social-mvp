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
} from "@livekit/components-react";

function CreatorFocusLayout() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const creator = tracks.find((t) => t.participant.identity.startsWith("creator_"));
  const buyer = tracks.find((t) => t.participant.identity.startsWith("buyer_"));

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
