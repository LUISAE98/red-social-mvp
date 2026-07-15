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

import { useEffect, useMemo, useRef, useState } from "react";
import { Room, Track } from "livekit-client";
import EgressHelper from "@livekit/egress-sdk";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useTracks,
  useParticipants,
  useRoomInfo,
} from "@livekit/components-react";
import { BRAND_DOMAIN } from "@/lib/brand";

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
  const RING_W = 7;
  const GAP = 5; // hueco TRANSPARENTE entre el avatar y el aro (deja ver el video)
  const OUTER = AVATAR + 2 * GAP + 2 * RING_W;
  const r = (OUTER - RING_W) / 2;
  return (
    <div style={{ position: "absolute", top: 34, left: 34, display: "flex", alignItems: "center", gap: 16, zIndex: 20 }}>
      <div style={{ position: "relative", width: OUTER, height: OUTER, flexShrink: 0, filter: "drop-shadow(0 4px 14px rgba(0,0,0,0.5))" }}>
        {/* Aro de Vibra como anillo real: centro y hueco transparentes */}
        <svg width={OUTER} height={OUTER} style={{ position: "absolute", inset: 0, display: "block" }} aria-hidden="true">
          <defs>
            <linearGradient id="vibraRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ec4899" />
              <stop offset="52%" stopColor="#9333ea" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
          <circle cx={OUTER / 2} cy={OUTER / 2} r={r} fill="none" stroke="url(#vibraRingGrad)" strokeWidth={RING_W} />
        </svg>
        <div
          style={{
            position: "absolute",
            top: GAP + RING_W,
            left: GAP + RING_W,
            width: AVATAR,
            height: AVATAR,
            borderRadius: "50%",
            overflow: "hidden",
            background: "#1a1a1a",
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

// Bloque "Vibra / vibraon.com" del cierre (con animación de entrada).
function VibraOutro({ show }: { show: boolean }) {
  return (
    <>
      <style>{`
        .vibraOutroText {
          background: linear-gradient(100deg, #ff2fb3 0%, #a855ff 45%, #4f46ff 100%);
          background-size: 220% 220%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: vibraTextFlow 4.5s ease-in-out infinite;
        }
        @keyframes vibraTextFlow { 0%,100%{ background-position:0% 50% } 50%{ background-position:100% 50% } }
        @keyframes vibraReveal {
          0%   { opacity:0; transform: translateY(28px) scale(0.94); filter: blur(12px); }
          60%  { opacity:1; }
          100% { opacity:1; transform: translateY(0) scale(1); filter: blur(0); }
        }
      `}</style>
      {show ? (
        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "stretch",
            animation: "vibraReveal 1s cubic-bezier(0.22, 1, 0.36, 1) both",
            willChange: "transform, opacity, filter",
          }}
        >
          <span className="vibraOutroText" style={{ fontSize: 135, fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1 }}>
            Vibra
          </span>
          <span style={{ display: "flex", justifyContent: "space-between", color: "#fff", fontSize: 39, fontWeight: 600, lineHeight: 1, marginTop: -5 }}>
            {BRAND_DOMAIN.split("").map((ch, i) => (
              <span key={i}>{ch}</span>
            ))}
          </span>
        </div>
      ) : null}
    </>
  );
}

function CreatorFocusLayout() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const participants = useParticipants();
  const roomInfo = useRoomInfo();
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

  // ── Cierre de la grabación ────────────────────────────────────────────────
  // Se dispara en cuanto la sala se marca "ended" (= el contador llegó a 0):
  //   t=0  la llamada se difumina + translúcida y aparece "Vibra/vibraon.com";
  //        el audio baja suave a 0 (~4s).
  //   t=4  se funde suavemente a negro → solo queda el letrero.
  //   t=9  se detiene la grabación (5s después del negro).
  const [outro, setOutro] = useState(false);
  const [black, setBlack] = useState(false);
  const [audioVol, setAudioVol] = useState(1);
  const outroStartedRef = useRef(false);
  useEffect(() => {
    // "closing" = el contador llegó a 0 → outro DIFUMINADO (blur→negro→Vibra).
    // "ended"   = fin/cancelación antes de concluir → CORTE a negro directo + Vibra 7s.
    let mode: "blur" | "cut" | null = null;
    try {
      const m = roomInfo.metadata ? JSON.parse(roomInfo.metadata) : null;
      if (m?.closing) mode = "blur";
      else if (m?.ended) mode = "cut";
    } catch { /* metadata no-JSON */ }
    if (!mode || outroStartedRef.current) return;
    outroStartedRef.current = true;

    if (mode === "blur") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOutro(true);
      // Audio: baja suave a 0 en ~4s.
      let a = 4000;
      const audioIv = setInterval(() => {
        a -= 60;
        setAudioVol(Math.max(0, a / 4000));
        if (a <= 0) clearInterval(audioIv);
      }, 60);
      setTimeout(() => setBlack(true), 4000);
      setTimeout(() => EgressHelper.endRecording(), 11000);
    } else {
      // Cancelación: a negro directo + "Vibra/vibraon.com" durante 7s.
      setOutro(true);
      setBlack(true);
      setAudioVol(0);
      setTimeout(() => EgressHelper.endRecording(), 7000);
    }
  }, [roomInfo.metadata]);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000" }}>
      {/* Contenido de la llamada — se difumina suavemente en el cierre */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          filter: outro ? "blur(18px)" : "none",
          transform: outro ? "scale(1.06)" : "none",
          transition: "filter 1.1s ease, transform 1.1s ease",
        }}
      >
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

      {/* Capa translúcida — atenúa la llamada difuminada al iniciar el cierre */}
      <div style={{ position: "absolute", inset: 0, background: "#000", opacity: outro ? 0.42 : 0, transition: "opacity 1.1s ease", pointerEvents: "none" }} />

      {/* Capa negra total — se funde suave y lento */}
      <div style={{ position: "absolute", inset: 0, background: "#000", opacity: black ? 1 : 0, transition: "opacity 2.6s cubic-bezier(0.4, 0, 0.2, 1)", pointerEvents: "none" }} />

      {/* Letrero "Vibra/vibraon.com" — aparece en t=0, nítido, encima de todo */}
      <div style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <VibraOutro show={outro} />
      </div>

      {/* Audio de la sala — el volumen baja a 0 en el cierre */}
      <RoomAudioRenderer volume={audioVol} />
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
        </LiveKitRoom>
      ) : (
        <div style={overlayStyle} />
      )}
    </>
  );
}
