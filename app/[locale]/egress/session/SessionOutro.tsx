"use client";

// Cierre de la grabación de sesiones 1-a-1.
//
// Vive aparte de la plantilla (page.tsx) para que sea una pieza aislada y
// reutilizable: la consume la plantilla real de grabación
// (app/[locale]/egress/session/page.tsx).
//
// Envuelve el contenido de la llamada (children) porque el cierre lo difumina.
// El consumidor decide QUÉ modo disparar (leyendo la metadata de la sala) y qué
// hacer al terminar (detener el egress); aquí sólo vive la coreografía.
//
// Está pensado para renderizarse dentro de un cuadro de 1920×1080.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BRAND_DOMAIN } from "@/lib/brand";

// "timer"  = el contador llegó a 0. SIN NEGRO NUNCA:
//     t=0 → t=3   se ve normal (video y audio normales)
//     t=3 → t=10  todo borroso + "Vibra / vibraon.com"; el audio baja MUY suave
//                 hasta 0 a lo largo de esos 7s
//     t=10        fin (onEnded)
//
// "cancel" = alguien terminó antes de tiempo:
//     se funde MUY suavemente a negro con "Vibra / vibraon.com" durante 7s.
export type OutroMode = "timer" | "cancel" | null;

export const OUTRO_TIMER_BLUR_AT = 3000;
export const OUTRO_TIMER_END_MS = 10000;
export const OUTRO_CANCEL_END_MS = 7000;

// Bloque "Vibra / vibraon.com" del cierre (con animación de entrada).
export function VibraOutro({ show }: { show: boolean }) {
  return (
    <>
      <style>{`
        .vibraOutroText {
          background: linear-gradient(100deg, #ff2fb3 0%, #a855f7 45%, #4f46ff 100%);
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

export default function SessionOutro({
  mode,
  children,
  onAudioVolume,
  onEnded,
}: {
  mode: OutroMode;
  children: ReactNode;
  // El volumen lo aplica el consumidor (RoomAudioRenderer). Aquí sólo se calcula
  // la curva de bajada, para que el preview pueda ignorarla sin audio.
  onAudioVolume?: (v: number) => void;
  onEnded?: () => void;
}) {
  const [outro, setOutro] = useState(false);
  const [black, setBlack] = useState(false);
  const startedRef = useRef(false);

  // Callbacks por ref: así el efecto sólo depende de `mode` y la coreografía
  // nunca se reinicia por un cambio de identidad de las funciones.
  const volRef = useRef(onAudioVolume);
  const endedRef = useRef(onEnded);
  useEffect(() => {
    volRef.current = onAudioVolume;
    endedRef.current = onEnded;
  }, [onAudioVolume, onEnded]);

  useEffect(() => {
    if (!mode || startedRef.current) return;
    startedRef.current = true;

    const timers: ReturnType<typeof setTimeout>[] = [];
    let audioIv: ReturnType<typeof setInterval> | null = null;

    if (mode === "timer") {
      // 3s normales; a los 3s entra el borroso + letrero y el audio baja en 7s.
      timers.push(
        setTimeout(() => {
          setOutro(true);
          let a = 7000;
          audioIv = setInterval(() => {
            a -= 60;
            volRef.current?.(Math.max(0, a / 7000));
            if (a <= 0 && audioIv) clearInterval(audioIv);
          }, 60);
        }, OUTRO_TIMER_BLUR_AT)
      );
      timers.push(setTimeout(() => endedRef.current?.(), OUTRO_TIMER_END_MS));
    } else {
      // Cancelación: negro MUY suave + "Vibra/vibraon.com" durante 7s.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOutro(true);
      setBlack(true);
      let a = 2000;
      audioIv = setInterval(() => {
        a -= 60;
        volRef.current?.(Math.max(0, a / 2000));
        if (a <= 0 && audioIv) clearInterval(audioIv);
      }, 60);
      timers.push(setTimeout(() => endedRef.current?.(), OUTRO_CANCEL_END_MS));
    }

    return () => {
      timers.forEach(clearTimeout);
      if (audioIv) clearInterval(audioIv);
    };
  }, [mode]);

  return (
    <>
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
        {children}
      </div>

      {/* Capa translúcida — atenúa la llamada difuminada al iniciar el cierre */}
      <div style={{ position: "absolute", inset: 0, background: "#000", opacity: outro ? 0.42 : 0, transition: "opacity 1.1s ease", pointerEvents: "none" }} />

      {/* Capa negra total — SOLO en cancelación; se funde MUY suave y lento.
          El cierre por reloj nunca se va a negro. */}
      <div style={{ position: "absolute", inset: 0, background: "#000", opacity: black ? 1 : 0, transition: "opacity 2.6s cubic-bezier(0.4, 0, 0.2, 1)", pointerEvents: "none" }} />

      {/* Letrero "Vibra/vibraon.com" — nítido, encima de todo. Por reloj entra
          en t=3; en cancelación, de inmediato. */}
      <div style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <VibraOutro show={outro} />
      </div>
    </>
  );
}
