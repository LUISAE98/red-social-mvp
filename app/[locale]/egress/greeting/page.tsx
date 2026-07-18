"use client";

// Plantilla de grabación (LiveKit WEB Egress) para la descarga ANIMADA de un
// saludo / consejo. El grabador headless abre esta URL con los datos del saludo
// en query params, y graba lo que se renderiza:
//
//   0–6s          INTRO (collage + Conecta·Comparte·Vibra + nombre + avatar con
//                 aro + vibraon.com). El video queda cargado detrás, en pausa.
//   6s            se desvanece el intro y arranca el video (con su audio).
//   +5s           entra la esquina (avatar+aro+nombre+tipo), como en sesiones.
//   dur−5s        sale la esquina.
//   fin del video → negro MUY suave (~2s) → "Vibra/vibraon.com" 5s → termina.
//
// La esquina solo aparece si el video dura >12s (si no, no cabe entrar+salir).
// Solo funciona desplegada (el grabador vive en la nube y abre esta URL pública).

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import EgressHelper from "@livekit/egress-sdk";
import GreetingIntro, { GREETING_INTRO_MS } from "./GreetingIntro";
import SessionOverlay from "../session/SessionOverlay";
import { VibraOutro } from "../session/SessionOutro";

const TYPE_LABEL: Record<string, string> = {
  saludo: "Saludo",
  consejo: "Consejo",
  mensaje: "Mensaje",
};

function GreetingEgressInner() {
  const params = useSearchParams();
  const playbackId = params.get("playbackId") ?? "";
  const name = params.get("name") ?? "";
  const avatarUrl = params.get("avatar") || null;
  const type = params.get("type") ?? "saludo";
  const orientation = params.get("orientation") === "vertical" ? "vertical" : "horizontal";
  const typeLabel = TYPE_LABEL[type] ?? "Saludo";

  const videoRef = useRef<HTMLVideoElement>(null);
  const [intro, setIntro] = useState(true);
  const [showCorner, setShowCorner] = useState(false);
  const [cornerOut, setCornerOut] = useState(false);
  const [black, setBlack] = useState(false);
  const [showVibra, setShowVibra] = useState(false);

  const startedRef = useRef(false);
  const cornerInRef = useRef(false);
  const cornerOutRef = useRef(false);
  const endedRef = useRef(false);

  // Arranca la secuencia (grabación + intro) cuando el video está listo, para
  // que no se grabe un frame en blanco. Fallback por si `canplay` no dispara.
  useEffect(() => {
    function start() {
      if (startedRef.current) return;
      startedRef.current = true;
      EgressHelper.startRecording();
      // 6s de intro; luego se desvanece y arranca el video con su audio.
      setTimeout(() => {
        setIntro(false);
        videoRef.current?.play().catch(() => {});
      }, GREETING_INTRO_MS);
    }
    const v = videoRef.current;
    if (v?.readyState && v.readyState >= 3) start();
    else v?.addEventListener("canplay", start, { once: true });
    const fallback = setTimeout(start, 8000);
    return () => {
      clearTimeout(fallback);
      v?.removeEventListener("canplay", start);
    };
  }, []);

  // Esquina: entra a los 5s de video, sale 5s antes del final. Solo si dura >12s.
  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration) || v.duration <= 12) return;
    if (!cornerInRef.current && v.currentTime >= 5) {
      cornerInRef.current = true;
      setShowCorner(true);
    }
    if (!cornerOutRef.current && v.currentTime >= v.duration - 5) {
      cornerOutRef.current = true;
      setCornerOut(true);
    }
  }

  // Fin del video → outro: negro MUY suave (2s) → Vibra 5s → termina la grabación.
  function onEnded() {
    if (endedRef.current) return;
    endedRef.current = true;
    setBlack(true);
    setTimeout(() => setShowVibra(true), 2000);
    setTimeout(() => setShowVibra(false), 7000);
    setTimeout(() => EgressHelper.endRecording(), 9000);
  }

  const src = playbackId ? `https://stream.mux.com/${playbackId}/high.mp4` : undefined;

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000" }}>
      {src ? (
        <video
          ref={videoRef}
          src={src}
          preload="auto"
          playsInline
          crossOrigin="anonymous"
          onTimeUpdate={onTimeUpdate}
          onEnded={onEnded}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000" }}
        />
      ) : null}

      {/* Esquina animada — igual que sesiones (entra/sale con el aro dibujándose). */}
      {showCorner ? (
        <SessionOverlay avatarUrl={avatarUrl} name={name} type="meet_greet" typeLabel={typeLabel} startDelay={0} out={cornerOut} />
      ) : null}

      {/* Cierre: negro MUY suave + "Vibra/vibraon.com". */}
      <div style={{ position: "absolute", inset: 0, background: "#000", zIndex: 30, opacity: black ? 1 : 0, transition: "opacity 2s cubic-bezier(0.4,0,0.2,1)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, zIndex: 31, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <VibraOutro show={showVibra} />
      </div>

      {/* Intro (6s) encima de todo hasta que se desvanece. */}
      {intro ? <GreetingIntro orientation={orientation} name={name} avatarUrl={avatarUrl} /> : null}
    </div>
  );
}

export default function GreetingEgressPage() {
  return (
    <>
      {/* El splash de carga taparía la grabación — ocultarlo es OBLIGATORIO. */}
      <style>{`#desktop-refresh-splash{display:none !important} html,body{background:#000 !important;margin:0}`}</style>
      <Suspense fallback={<div style={{ position: "absolute", inset: 0, background: "#000" }} />}>
        <GreetingEgressInner />
      </Suspense>
    </>
  );
}
