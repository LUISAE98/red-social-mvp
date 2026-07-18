"use client";

// SIMULACIÓN (solo lienzo de diseño) de cómo se vería la descarga ANIMADA de un
// saludo / consejo. NO toca el sistema real de descarga (videoOverlay.ts). Sirve
// para aprobar el look antes de implementarlo.
//
// Línea de tiempo (un reloj desde t=0):
//   0–6s    INTRO sobre el fondo del splash (collage):
//             0–1s  solo el fondo
//             ~2–5s "Conecta. Comparte. Vibra." + nombre + avatar con aro que se
//                   rellena + vibraon.com; luego todo se desvanece
//   6s      empieza el saludo/consejo (aquí: un placeholder de video)
//   6–11s   esquina VACÍA
//   11s     entra la esquina (avatar+aro+nombre+tipo) EXACTO como en sesiones
//   15s     (5s antes de que "termine" el contenido) sale la esquina, como en sesión
//   20s     el contenido "termina" → se va a negro MUY suave (~2s)
//   22s     ya en negro, aparece "Vibra / vibraon.com" (5s)
//   27s     desaparece; ~2s después termina
//
// Formatos: horizontal (1920×1080) y vertical (1080×1920). En vertical el fondo
// usa la variante de celular del splash (3 columnas).

import { useEffect, useMemo, useState } from "react";
import { BRAND_DOMAIN } from "@/lib/brand";
import { buildCollageTiles } from "@/lib/collage";
import SessionOverlay from "@/app/[locale]/egress/session/SessionOverlay";
import { VibraOutro } from "@/app/[locale]/egress/session/SessionOutro";

type Orientation = "horizontal" | "vertical";

// Hitos en ms (mismos para ambos formatos).
const T = {
  content: 6000,
  cornerIn: 11000,
  cornerOut: 15000,
  black: 20000,
  vibra: 22000,
  vibraOut: 27000,
  end: 29000,
};

export default function GreetingDownloadPreview({
  orientation,
  name,
  serviceLabel,
  holdIntro = false,
}: {
  orientation: Orientation;
  name: string;
  serviceLabel: string;
  // Solo para el lienzo de diseño: deja el intro fijo (no avanza a contenido)
  // para revisar la portada sin esperar la secuencia.
  holdIntro?: boolean;
}) {
  const vertical = orientation === "vertical";
  const W = vertical ? 1080 : 1920;
  const H = vertical ? 1920 : 1080;

  const tiles = useMemo(() => buildCollageTiles(), []);

  const [content, setContent] = useState(false);
  const [showCorner, setShowCorner] = useState(false);
  const [cornerOut, setCornerOut] = useState(false);
  const [black, setBlack] = useState(false);
  const [showVibra, setShowVibra] = useState(false);

  useEffect(() => {
    if (holdIntro) return;
    const timers = [
      setTimeout(() => setContent(true), T.content),
      setTimeout(() => setShowCorner(true), T.cornerIn),
      setTimeout(() => setCornerOut(true), T.cornerOut),
      setTimeout(() => setBlack(true), T.black),
      setTimeout(() => setShowVibra(true), T.vibra),
      setTimeout(() => setShowVibra(false), T.vibraOut),
    ];
    return () => timers.forEach(clearTimeout);
  }, [holdIntro]);

  // Avatar del intro con aro que se rellena (mismo lenguaje del intro de sesión).
  const AV = vertical ? 168 : 190;
  // Aro un poco más grueso en horizontal: con el avatar grande, 8px se veía
  // delgado y el relleno "flojo". Proporcional al avatar.
  const RW = vertical ? 8 : 10;
  const GAP = 6;
  const OUTER = AV + 2 * GAP + 2 * RW;
  const rr = (OUTER - RW) / 2;

  // Collage: 6 columnas (horizontal) / 3 (vertical, look de celular).
  const cols = vertical ? 3 : 6;
  // Horizontal: MISMO fondo que el intro de sesiones (SessionIntro), idéntico:
  // 6 col, 2880px, rotateX 15, rotateZ -11, scale 1.08 — SIN translateX. Nada
  // inventado. (Mi error anterior fue agregarle un translateX que no existe ahí.)
  const gridW = vertical ? 1900 : 2880;
  const rot = vertical
    ? "translateX(240px) rotateX(9deg) rotateZ(-9deg) scale(1.4)"
    : "rotateX(15deg) rotateZ(-11deg) scale(1.08)";

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000" }}>
      <style>{`
        .gdIntro {
          position: absolute; inset: 0; overflow: hidden; background: #07030f; z-index: 40;
          animation: ${holdIntro ? "none" : "gdIntroOut 0.9s cubic-bezier(0.4,0,0.2,1) 5200ms both"};
        }
        @keyframes gdIntroOut { from { opacity: 1 } to { opacity: 0 } }

        .gdStage { position: absolute; inset: -22%; perspective: 1400px; display: grid; place-items: center; }
        .gdGrid {
          display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 16px;
          width: ${gridW}px; transform: ${rot}; filter: saturate(1.02);
          animation: gdDrift 46s ease-in-out infinite alternate;
        }
        @keyframes gdDrift { from { transform: ${rot} translateY(0) } to { transform: ${rot} translateY(-46px) } }
        .gdTile { grid-column: span 1; aspect-ratio: 1/1; overflow: hidden;
          background: linear-gradient(160deg,#1b1530,#0d0a18); box-shadow: 0 18px 42px rgba(0,0,0,0.55); }
        .gdTile.is-wide { grid-column: span 2; aspect-ratio: 2/1; }
        .gdTile img { width:100%; height:100%; object-fit:cover; display:block; opacity:0.9; }

        .gdVignette { position:absolute; inset:0; background:
          radial-gradient(135% 120% at 60% 45%, rgba(6,3,14,0.4) 0%, rgba(5,2,11,0.66) 55%, rgba(3,1,8,0.86) 100%),
          linear-gradient(180deg, rgba(5,2,11,0.56) 0%, rgba(5,2,11,0.3) 45%, rgba(3,1,8,0.62) 100%); }

        .gdContent {
          position:absolute; inset:0; z-index:2;
          display:flex; flex-direction:column; align-items:center; justify-content:center;
          gap: ${vertical ? 34 : 26}px; transform: translateY(-2%);
        }
        .gdTitle {
          font-size: ${vertical ? 58 : 62}px; font-weight:700; letter-spacing:-0.03em; line-height:1.08;
          color:#fff; text-align:center; text-shadow:0 2px 30px rgba(0,0,0,0.55);
          animation: gdRise 1.0s cubic-bezier(0.22,1,0.36,1) 2000ms both;
        }
        .gdVibra {
          background: linear-gradient(100deg,#ff2fb3 0%,#a855ff 45%,#4f46ff 100%);
          background-size:220% 220%; -webkit-background-clip:text; background-clip:text; color:transparent;
          animation: gdVibraFlow 4.5s ease-in-out infinite;
        }
        @keyframes gdVibraFlow { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        .gdName {
          font-size: ${vertical ? 34 : 33}px; font-weight:600; letter-spacing:-0.01em; color:#fff;
          text-shadow:0 2px 18px rgba(0,0,0,0.6);
          animation: gdRise 0.9s cubic-bezier(0.22,1,0.36,1) 2500ms both;
        }
        @keyframes gdRise {
          from { opacity:0; transform: translateY(18px); filter: blur(10px); }
          to { opacity:1; transform: translateY(0); filter: blur(0); }
        }
        .gdAvatar {
          position:relative; flex-shrink:0; filter: drop-shadow(0 10px 34px rgba(0,0,0,0.6));
          animation: gdPop 0.7s cubic-bezier(0.34,1.56,0.64,1) 2800ms both;
        }
        @keyframes gdPop { from { opacity:0; transform: scale(0.4) } to { opacity:1; transform: scale(1) } }
        .gdRing circle {
          /* pathLength=100 (en el <circle>) normaliza el largo del trazo → llena de
             0 a 100 EXACTO, sin el desfase que dejaba un pedazo cubierto al inicio
             y un hueco al final. Se dibuja tras el pop del avatar (3500ms). */
          stroke-dasharray: 100;
          animation: gdRingDraw 1.3s cubic-bezier(0.65,0,0.35,1) 3500ms both;
        }
        @keyframes gdRingDraw { from { stroke-dashoffset: 100 } to { stroke-dashoffset: 0 } }
        .gdDomain {
          font-size: ${vertical ? 32 : 30}px; font-weight:600; color:#fff; letter-spacing:0.01em;
          text-shadow:0 2px 18px rgba(0,0,0,0.6); margin-top: ${vertical ? 40 : 34}px;
          animation: gdRise 0.9s cubic-bezier(0.22,1,0.36,1) 3400ms both;
        }

        .gdBlack { position:absolute; inset:0; background:#000; z-index:30; opacity:0;
          transition: opacity 2s cubic-bezier(0.4,0,0.2,1); pointer-events:none; }
        .gdBlack.on { opacity:1; }
      `}</style>

      {/* ── Contenido del saludo (placeholder) ── */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,#334155 0%,#0f172a 100%)", display: "grid", placeItems: "center" }}>
        <span style={{ color: "rgba(255,255,255,0.22)", fontSize: vertical ? 40 : 46, fontWeight: 700, textAlign: "center", padding: 24 }}>
          (aquí va el {serviceLabel.toLowerCase()})
        </span>
      </div>

      {/* ── Esquina: entra a los 5s de contenido (t=11s), sale a t=15s. Igual que sesión. ── */}
      {showCorner ? (
        <SessionOverlay avatarUrl={null} name={name} type="meet_greet" typeLabel={serviceLabel} startDelay={0} out={cornerOut} />
      ) : null}

      {/* ── Negro suave del cierre + Vibra/vibraon.com ── */}
      <div className={`gdBlack${black ? " on" : ""}`} />
      <div style={{ position: "absolute", inset: 0, zIndex: 31, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <VibraOutro show={showVibra} />
      </div>

      {/* ── Intro (0–6s), encima de todo hasta que se desvanece ── */}
      {!content ? (
        <div className="gdIntro">
          <div className="gdStage" aria-hidden="true">
            <div className="gdGrid">
              {tiles.map((t, i) => (
                <div key={i} className={`gdTile${t.wide ? " is-wide" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/${t.src}.webp`} alt="" draggable={false} />
                </div>
              ))}
            </div>
          </div>
          <div className="gdVignette" />

          <div className="gdContent">
            <div className="gdTitle">Conecta. Comparte. <span className="gdVibra">Vibra.</span></div>
            <div className="gdName">{name}</div>
            <div className="gdAvatar" style={{ width: OUTER, height: OUTER }}>
              <svg className="gdRing" width={OUTER} height={OUTER} style={{ position: "absolute", inset: 0, display: "block", transform: "rotate(-90deg)" }} aria-hidden="true">
                <defs>
                  <linearGradient id="gdRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#ec4899" />
                    <stop offset="52%" stopColor="#9333ea" />
                    <stop offset="100%" stopColor="#3b82f6" />
                  </linearGradient>
                </defs>
                <circle pathLength={100} cx={OUTER / 2} cy={OUTER / 2} r={rr} fill="none" stroke="url(#gdRingGrad)" strokeWidth={RW} strokeLinecap="round" />
              </svg>
              <div style={{ position: "absolute", top: GAP + RW, left: GAP + RW, width: AV, height: AV, borderRadius: "50%", overflow: "hidden", background: "#1a1a1a", display: "grid", placeItems: "center" }}>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: Math.round(AV * 0.4) }}>{(name || "?").trim().charAt(0).toUpperCase()}</span>
              </div>
            </div>
            <div className="gdDomain">{BRAND_DOMAIN}</div>
          </div>
        </div>
      ) : null}

      {/* dimensiones lógicas del cuadro (para referencia) */}
      <span style={{ display: "none" }}>{W}x{H}</span>
    </div>
  );
}
