"use client";

// Portada animada de 6s para la descarga de saludos / consejos.
// Compartida por la plantilla real de grabación (egress/greeting) y el preview
// del lienzo de diseño, para que NO se desincronicen.
//
// Línea de tiempo (los delays ya incluyen el HOLD de 2s de solo-fondo):
//   0–2s   solo el collage de fondo
//   2.0s   "Conecta. Comparte. Vibra."
//   2.5s   nombre del creador
//   2.8s   avatar (pop) · 3.5s el aro se rellena (pathLength, limpio)
//   3.4s   vibraon.com
//   5.2s   todo + el fondo se desvanecen (0.9s)
//
// Formatos: el fondo horizontal es RÉPLICA EXACTA del intro de sesiones; el
// vertical usa 3 columnas (look de celular). Sin inventar valores.

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { BRAND_DOMAIN } from "@/lib/brand";
import { buildCollageTiles } from "@/lib/collage";

export const GREETING_INTRO_MS = 6000;

export default function GreetingIntro({
  orientation,
  name,
  avatarUrl,
  // El preview lo congela para revisar la portada sin esperar la secuencia.
  hold = false,
}: {
  orientation: "horizontal" | "vertical";
  name: string;
  avatarUrl: string | null;
  hold?: boolean;
}) {
  const vertical = orientation === "vertical";
  const tiles = useMemo(() => buildCollageTiles(), []);
  const t = useTranslations("wallet");

  const AV = vertical ? 168 : 190;
  const RW = vertical ? 8 : 10;
  const GAP = 6;
  const OUTER = AV + 2 * GAP + 2 * RW;
  const rr = (OUTER - RW) / 2;

  const cols = vertical ? 3 : 6;
  const gridW = vertical ? 1900 : 2880;
  // Horizontal = mismo fondo que el intro de sesiones (SessionIntro), idéntico.
  const rot = vertical
    ? "translateX(240px) rotateX(9deg) rotateZ(-9deg) scale(1.4)"
    : "rotateX(15deg) rotateZ(-11deg) scale(1.08)";

  return (
    <div className="giRoot">
      <style>{`
        .giRoot {
          position: absolute; inset: 0; overflow: hidden; background: #07030f; z-index: 40;
          animation: ${hold ? "none" : "giOut 0.9s cubic-bezier(0.4,0,0.2,1) 5200ms both"};
        }
        @keyframes giOut { from { opacity: 1 } to { opacity: 0 } }

        .giStage { position: absolute; inset: -22%; perspective: 1400px; display: grid; place-items: center; }
        .giGrid {
          display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 16px;
          width: ${gridW}px; transform: ${rot}; filter: saturate(1.02);
          animation: giDrift 46s ease-in-out infinite alternate;
        }
        @keyframes giDrift { from { transform: ${rot} translateY(0) } to { transform: ${rot} translateY(-46px) } }
        .giTile { grid-column: span 1; aspect-ratio: 1/1; overflow: hidden;
          background: linear-gradient(160deg,#1b1530,#0d0a18); box-shadow: 0 18px 42px rgba(0,0,0,0.55); }
        .giTile.is-wide { grid-column: span 2; aspect-ratio: 2/1; }
        .giTile img { width:100%; height:100%; object-fit:cover; display:block; opacity:0.9; }

        .giVignette { position:absolute; inset:0; background:
          radial-gradient(135% 120% at 60% 45%, rgba(6,3,14,0.4) 0%, rgba(5,2,11,0.66) 55%, rgba(3,1,8,0.86) 100%),
          linear-gradient(180deg, rgba(5,2,11,0.56) 0%, rgba(5,2,11,0.3) 45%, rgba(3,1,8,0.62) 100%); }

        .giContent {
          position:absolute; inset:0; z-index:2;
          display:flex; flex-direction:column; align-items:center; justify-content:center;
          gap: ${vertical ? 34 : 26}px; transform: translateY(-2%);
        }
        .giTitle {
          font-size: ${vertical ? 58 : 62}px; font-weight:700; letter-spacing:-0.03em; line-height:1.08;
          color:#fff; text-align:center; text-shadow:0 2px 30px rgba(0,0,0,0.55);
          animation: giRise 1.0s cubic-bezier(0.22,1,0.36,1) 2000ms both;
        }
        .giVibra {
          background: linear-gradient(100deg,#ff2fb3 0%,#a855f7 45%,#4f46ff 100%);
          background-size:220% 220%; -webkit-background-clip:text; background-clip:text; color:transparent;
          animation: giVibraFlow 4.5s ease-in-out infinite;
        }
        @keyframes giVibraFlow { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        .giName {
          font-size: ${vertical ? 34 : 33}px; font-weight:600; letter-spacing:-0.01em; color:#fff;
          text-shadow:0 2px 18px rgba(0,0,0,0.6);
          animation: giRise 0.9s cubic-bezier(0.22,1,0.36,1) 2500ms both;
        }
        @keyframes giRise {
          from { opacity:0; transform: translateY(18px); filter: blur(10px); }
          to { opacity:1; transform: translateY(0); filter: blur(0); }
        }
        .giAvatar {
          position:relative; flex-shrink:0; filter: drop-shadow(0 10px 34px rgba(0,0,0,0.6));
          animation: giPop 0.7s cubic-bezier(0.34,1.56,0.64,1) 2800ms both;
        }
        @keyframes giPop { from { opacity:0; transform: scale(0.4) } to { opacity:1; transform: scale(1) } }
        .giRing circle {
          /* pathLength=100 → el aro se rellena de 0 a 100 EXACTO (sin pedazo
             cubierto al inicio ni hueco al final). Tras el pop del avatar. */
          stroke-dasharray: 100;
          animation: giRingDraw 1.3s cubic-bezier(0.65,0,0.35,1) 3500ms both;
        }
        @keyframes giRingDraw { from { stroke-dashoffset: 100 } to { stroke-dashoffset: 0 } }
        .giDomain {
          font-size: ${vertical ? 32 : 30}px; font-weight:600; color:#fff; letter-spacing:0.01em;
          text-shadow:0 2px 18px rgba(0,0,0,0.6); margin-top: ${vertical ? 110 : 92}px;
          animation: giRise 0.9s cubic-bezier(0.22,1,0.36,1) 3400ms both;
        }
      `}</style>

      <div className="giStage" aria-hidden="true">
        <div className="giGrid">
          {tiles.map((t, i) => (
            <div key={i} className={`giTile${t.wide ? " is-wide" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/${t.src}.webp`} alt="" draggable={false} />
            </div>
          ))}
        </div>
      </div>
      <div className="giVignette" />

      <div className="giContent">
        <div className="giTitle">{t("egressTaglinePrefix")} <span className="giVibra">Vibra.</span></div>
        <div className="giName">{name}</div>
        <div className="giAvatar" style={{ width: OUTER, height: OUTER }}>
          <svg className="giRing" width={OUTER} height={OUTER} style={{ position: "absolute", inset: 0, display: "block", transform: "rotate(-90deg)" }} aria-hidden="true">
            <defs>
              <linearGradient id="giRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ec4899" />
                <stop offset="52%" stopColor="#9333ea" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
            </defs>
            <circle pathLength={100} cx={OUTER / 2} cy={OUTER / 2} r={rr} fill="none" stroke="url(#giRingGrad)" strokeWidth={RW} strokeLinecap="round" />
          </svg>
          <div style={{ position: "absolute", top: GAP + RW, left: GAP + RW, width: AV, height: AV, borderRadius: "50%", overflow: "hidden", background: "#1a1a1a", display: "grid", placeItems: "center" }}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ color: "#fff", fontWeight: 700, fontSize: Math.round(AV * 0.4) }}>{(name || "?").trim().charAt(0).toUpperCase()}</span>
            )}
          </div>
        </div>
        <div className="giDomain">{BRAND_DOMAIN}</div>
      </div>
    </div>
  );
}
