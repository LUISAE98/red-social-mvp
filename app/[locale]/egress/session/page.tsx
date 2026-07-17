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
import SessionIntro, { INTRO_FADE_AT, INTRO_TOTAL_MS } from "./SessionIntro";
import SessionOutro, { type OutroMode } from "./SessionOutro";

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

function CreatorFocusLayout() {
  // Cámaras + pantalla compartida (solo el creador puede compartir).
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], { onlySubscribed: true });
  const participants = useParticipants();
  const roomInfo = useRoomInfo();
  const creator = tracks.find(
    (t) => t.source === Track.Source.Camera && t.participant.identity.startsWith("creator_")
  );
  const buyer = tracks.find(
    (t) => t.source === Track.Source.Camera && t.participant.identity.startsWith("buyer_")
  );
  const screen = tracks.find(
    (t) => t.source === Track.Source.ScreenShare && t.participant.identity.startsWith("creator_")
  );
  // Cuando el creador comparte pantalla, ésta toma el cuadro grande y ambas
  // cámaras bajan a PiP (así la grabación conserva la cara del creador).
  const bigTrack = screen ?? creator;
  const pipTracks = screen ? [creator, buyer] : [buyer];

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
  // Fases señaladas por metadata de la sala (signalSessionClosing / endSession):
  //
  //  · "overlayOut" (t=-5, faltan 5s para el 0): el overlay de la esquina
  //    (avatar + aro + nombre + tipo) se desvanece suavemente.
  //
  //  · "closing" (t=0, el contador llegó a 0) → outro POR RELOJ. SIN NEGRO:
  //      t=0 → t=3   se ve normal (video y audio normales)
  //      t=3 → t=10  todo borroso + "Vibra / vibraon.com"; el audio baja MUY
  //                  suave hasta 0 a lo largo de esos 7s
  //      t=10        se detiene la grabación
  //
  //  · "ended" (cancelación antes de concluir) → outro POR CANCELACIÓN:
  //    se funde MUY suavemente a negro con "Vibra / vibraon.com" durante 7s.
  const [overlayOut, setOverlayOut] = useState(false);
  const [outroMode, setOutroMode] = useState<OutroMode>(null);
  // El intro arranca en silencio y sube el volumen al máximo al desvanecerse.
  const [audioVol, setAudioVol] = useState(0);
  const [intro, setIntro] = useState(true);
  const overlayOutRef = useRef(false);

  // Intro: al terminar el desvanecido, el audio sube suave de 0 al máximo y la
  // sesión queda reproduciéndose tal cual. Corre una sola vez, al montar.
  useEffect(() => {
    const rise = setTimeout(() => {
      let v = 0;
      const iv = setInterval(() => {
        v += 0.038;
        setAudioVol(Math.min(1, v));
        if (v >= 1) clearInterval(iv);
      }, 60);
    }, INTRO_FADE_AT);
    const done = setTimeout(() => setIntro(false), INTRO_TOTAL_MS);
    return () => {
      clearTimeout(rise);
      clearTimeout(done);
    };
  }, []);
  useEffect(() => {
    let m: { overlayOut?: boolean; closing?: boolean; ended?: boolean } | null = null;
    try {
      m = roomInfo.metadata ? JSON.parse(roomInfo.metadata) : null;
    } catch { /* metadata no-JSON */ }
    if (!m) return;

    // Fase t=-5: desvanecer el overlay de la esquina. Se "engancha" (latched)
    // para que no se revierta si la metadata se reemplaza después.
    if (m.overlayOut && !overlayOutRef.current) {
      overlayOutRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverlayOut(true);
    }

    // La coreografía del cierre vive en <SessionOutro>; aquí sólo se decide el modo.
    setOutroMode((prev) => prev ?? (m.closing ? "timer" : m.ended ? "cancel" : null));
  }, [roomInfo.metadata]);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000" }}>
      {/* El cierre (difuminado, letrero, negro de cancelación y curva de audio)
          vive en <SessionOutro>, que envuelve el contenido de la llamada. */}
      <SessionOutro
        mode={outroMode}
        onAudioVolume={setAudioVol}
        onEnded={() => EgressHelper.endRecording()}
      >
        {/* Cuadro grande — pantalla compartida del creador si la hay; si no, su
            cámara. La pantalla va "contain" para no recortar contenido. */}
        {bigTrack ? (
          <VideoTrack
            trackRef={bigTrack}
            style={{
              width: "100%",
              height: "100%",
              objectFit: screen ? "contain" : "cover",
              background: "#000",
            }}
          />
        ) : null}

        {/* PiP(s) en la esquina inferior derecha. Sin compartir: solo el comprador.
            Compartiendo: cámara del creador + comprador, lado a lado. */}
        <div
          style={{
            position: "absolute",
            right: "2.5%",
            bottom: "4%",
            display: "flex",
            gap: "1.4%",
            width: screen ? "42%" : "24%",
          }}
        >
          {pipTracks.map((t, i) =>
            t ? (
              <div
                key={i}
                style={{
                  flex: 1,
                  aspectRatio: "16 / 9",
                  borderRadius: 12,
                  overflow: "hidden",
                  border: "2px solid rgba(255,255,255,0.85)",
                  background: "#111",
                  boxShadow: "0 6px 24px rgba(0,0,0,0.55)",
                }}
              >
                <VideoTrack
                  trackRef={t}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
            ) : null
          )}
        </div>

        {/* Overlay horneado (avatar + aro + nombre + tipo).
            Se desvanece suavemente a falta de 5s para el 0 (fase "overlayOut"). */}
        {overlay ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: overlayOut ? 0 : 1,
              transition: "opacity 1.6s cubic-bezier(0.4, 0, 0.2, 1)",
              pointerEvents: "none",
            }}
          >
            <OverlayBadge avatarUrl={overlay.avatarUrl} name={overlay.name} type={overlay.type} />
          </div>
        ) : null}
      </SessionOutro>

      {/* Intro de apertura — se desvanece revelando la sesión ya en curso */}
      {intro ? <SessionIntro avatarUrl={overlay?.avatarUrl ?? null} name={overlay?.name ?? ""} /> : null}

      {/* Audio de la sala — sube de 0 al máximo tras el intro y baja a 0 en el cierre */}
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
