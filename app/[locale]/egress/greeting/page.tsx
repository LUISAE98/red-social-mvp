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
  const [vibraOut, setVibraOut] = useState(false);

  const startedRef = useRef(false);
  const cornerInRef = useRef(false);
  const cornerOutRef = useRef(false);
  const endedRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Chrome (el grabador headless) ofrece traducir la página porque el texto está
  // en español y el `lang` no; ese panel de Google Translate tapaba la esquina.
  // Lo desactivamos con translate="no" + meta notranslate al montar.
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("translate", "no");
    html.classList.add("notranslate");
    const meta = document.createElement("meta");
    meta.name = "google";
    meta.content = "notranslate";
    document.head.appendChild(meta);
  }, []);

  // Fin del video → outro breve (~5s): negro MUY suave → entra "Vibra/vibraon.com"
  // → se desvanece bonito (no de golpe) → termina la grabación.
  // Declarada antes del effect porque el watchdog la referencia.
  function onEnded() {
    if (endedRef.current) return;
    endedRef.current = true;
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    setBlack(true);
    setTimeout(() => setShowVibra(true), 1500);   // entra cuando ya está negro
    setTimeout(() => setVibraOut(true), 4000);     // salida animada (fade + drift + blur)
    setTimeout(() => EgressHelper.endRecording(), 5200);
  }

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
        const v = videoRef.current;
        v?.play().catch(() => {});
        // Watchdog: si el video se atora o nunca termina, forzar el cierre para
        // no dejar la grabación colgada (dur+15s, o 180s si no se conoce).
        const capS = v && isFinite(v.duration) && v.duration > 0 ? v.duration + 15 : 180;
        watchdogRef.current = setTimeout(onEnded, capS * 1000);
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

  const src = playbackId ? `https://stream.mux.com/${playbackId}/high.mp4` : undefined;

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000" }}>
      {src ? (
        <video
          ref={videoRef}
          src={src}
          preload="auto"
          playsInline
          onTimeUpdate={onTimeUpdate}
          onEnded={onEnded}
          onError={onEnded}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000" }}
        />
      ) : null}

      {/* Esquina animada — igual que sesiones (entra/sale con el aro dibujándose). */}
      {showCorner ? (
        <SessionOverlay avatarUrl={avatarUrl} name={name} type="meet_greet" typeLabel={typeLabel} startDelay={0} out={cornerOut} />
      ) : null}

      {/* Cierre: negro MUY suave + "Vibra/vibraon.com" con entrada y SALIDA suaves. */}
      <div style={{ position: "absolute", inset: 0, background: "#000", zIndex: 30, opacity: black ? 1 : 0, transition: "opacity 2s cubic-bezier(0.4,0,0.2,1)", pointerEvents: "none" }} />
      <div
        style={{
          position: "absolute", inset: 0, zIndex: 31,
          display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
          opacity: vibraOut ? 0 : 1,
          transform: vibraOut ? "translateY(-16px) scale(0.96)" : "none",
          filter: vibraOut ? "blur(10px)" : "none",
          transition: "opacity 1s ease, transform 1s ease, filter 1s ease",
        }}
      >
        {showVibra ? <VibraOutro show /> : null}
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
