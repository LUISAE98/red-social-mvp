"use client";

// Intro de apertura de la grabación de sesiones 1-a-1.
//
// Vive aparte de la plantilla (page.tsx) para que sea una pieza aislada y
// reutilizable: la consume la plantilla real de grabación
// (app/[locale]/egress/session/page.tsx).
//
// Solo añade apertura: no toca el overlay de la esquina, ni el contador de la
// sesión, ni los tiempos del cierre.
//
// Está pensado para renderizarse dentro de un cuadro de 1920×1080 (los px son
// absolutos, no responsive: el grabador headless siempre corre a 1080p).

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { BRAND_DOMAIN } from "@/lib/brand";
import { buildCollageTiles } from "@/lib/collage";

// HOLD: se ve SOLO el fondo estos 2s antes de que entre nada. Todos los delays
// de abajo lo llevan sumado, así que mover este número corre toda la secuencia.
const HOLD = 2000;

// Línea de tiempo (los tiempos ya incluyen el HOLD de 2s):
//   0→2s  solo el fondo (collage), sin textos ni avatar
//   2.3s  "Conecta. Comparte. Vibra."  (sube + enfoca)
//   3.3s  "Tu momento con {creador}"   (sube + aparece)
//   4.0s  avatar del creador           (pop con rebote)
//   4.4s  aro de Vibra                 (se dibuja como si cargara, 1.7s)
//   4.7s  vibraon.com                  (sube + aparece)
//   6.4s  todo + el fondo se desvanecen (1.4s); el consumidor sube el audio aquí
//   8.2s  el intro se desmonta y queda la sesión tal cual
export const INTRO_FADE_AT = HOLD + 4400;
export const INTRO_TOTAL_MS = HOLD + 6200;

export default function SessionIntro({
  avatarUrl,
  name,
}: {
  avatarUrl: string | null;
  name: string;
}) {
  const tiles = useMemo(() => buildCollageTiles(), []);
  const t = useTranslations("wallet");
  const initials = (name || "?").trim().charAt(0).toUpperCase();

  // Aro que se "carga": se dibuja animando stroke-dashoffset de C → 0.
  const AVATAR = 190;
  const RING_W = 8;
  const GAP = 6;
  const OUTER = AVATAR + 2 * GAP + 2 * RING_W;
  const r = (OUTER - RING_W) / 2;
  const C = 2 * Math.PI * r;

  return (
    <div className="introRoot">
      <style>{`
        .introRoot {
          position: absolute; inset: 0; overflow: hidden; background: #07030f; z-index: 40;
          animation: introOut 1.4s cubic-bezier(0.4, 0, 0.2, 1) ${INTRO_FADE_AT}ms both;
        }
        @keyframes introOut { from { opacity: 1 } to { opacity: 0 } }

        .introStage { position: absolute; inset: -22%; perspective: 1400px; display: grid; place-items: center; }
        /* El grabador siempre es 1920x1080 horizontal → 4 columnas, y las 10
           imágenes cierran en 4+4+4+3 (ver lib/collage). Sin "dense":
           reacomodaría los tiles y rompería el embaldosado. Ancho fijo en px
           (=110% de 1920, el mínimo que cubre al estar rotada) para que el
           preview del lienzo de diseño mida contra el cuadro y no contra la
           ventana del navegador. */
        .introGrid {
          display: grid; grid-template-columns: repeat(6, 1fr);
          gap: 16px; width: 2880px; transform: rotateX(15deg) rotateZ(-11deg) scale(1.08);
          filter: saturate(1.02); animation: introDrift 46s ease-in-out infinite alternate;
        }
        @keyframes introDrift {
          from { transform: rotateX(15deg) rotateZ(-11deg) scale(1.08) translateY(0) }
          to   { transform: rotateX(15deg) rotateZ(-11deg) scale(1.08) translateY(-46px) }
        }
        .introTile {
          grid-column: span 1; aspect-ratio: 1 / 1; overflow: hidden;
          background: linear-gradient(160deg, #1b1530, #0d0a18);
          box-shadow: 0 18px 42px rgba(0,0,0,0.55);
        }
        .introTile.is-wide { grid-column: span 2; aspect-ratio: 2 / 1; }
        .introTile img { width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0.9; }

        .introVignette {
          position: absolute; inset: 0;
          background:
            radial-gradient(135% 120% at 60% 45%, rgba(6,3,14,0.4) 0%, rgba(5,2,11,0.66) 55%, rgba(3,1,8,0.86) 100%),
            linear-gradient(180deg, rgba(5,2,11,0.56) 0%, rgba(5,2,11,0.3) 45%, rgba(3,1,8,0.62) 100%);
        }

        /* Bloque central, un poco por encima del centro exacto. */
        .introContent {
          position: absolute; inset: 0; z-index: 2;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 26px; transform: translateY(-2.5%);
        }

        .introTitle {
          font-size: 62px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.08;
          color: #fff; white-space: nowrap; text-shadow: 0 2px 30px rgba(0,0,0,0.55);
          animation: introRise 1.1s cubic-bezier(0.22, 1, 0.36, 1) ${HOLD + 300}ms both;
        }
        .introVibra {
          background: linear-gradient(100deg, #ff2fb3 0%, #a855f7 45%, #4f46ff 100%);
          background-size: 220% 220%; -webkit-background-clip: text; background-clip: text;
          color: transparent; animation: introVibraFlow 4.5s ease-in-out infinite;
        }
        @keyframes introVibraFlow { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }

        .introMoment {
          font-size: 31px; font-weight: 500; letter-spacing: -0.01em; color: rgba(255,255,255,0.86);
          text-shadow: 0 2px 18px rgba(0,0,0,0.6);
          animation: introRise 0.9s cubic-bezier(0.22, 1, 0.36, 1) ${HOLD + 1300}ms both;
        }

        @keyframes introRise {
          from { opacity: 0; transform: translateY(18px); filter: blur(10px); }
          to   { opacity: 1; transform: translateY(0); filter: blur(0); }
        }

        /* Pop con rebote sutil — entrada del avatar. */
        .introAvatar {
          position: relative; flex-shrink: 0;
          filter: drop-shadow(0 10px 34px rgba(0,0,0,0.6));
          animation: introPop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) ${HOLD + 2000}ms both;
        }
        @keyframes introPop {
          from { opacity: 0; transform: scale(0.4); }
          to   { opacity: 1; transform: scale(1); }
        }

        /* El aro se dibuja como si cargara, hasta cerrarse por completo. */
        .introRing circle {
          stroke-dasharray: ${C};
          stroke-dashoffset: ${C};
          animation: introRingDraw 1.7s cubic-bezier(0.65, 0, 0.35, 1) ${HOLD + 2400}ms both;
        }
        @keyframes introRingDraw { to { stroke-dashoffset: 0 } }

        .introDomain {
          position: absolute; inset-inline-start: 0; inset-inline-end: 0; bottom: 58px; z-index: 2; text-align: center;
          font-size: 30px; font-weight: 600; color: #fff; letter-spacing: 0.01em;
          text-shadow: 0 2px 18px rgba(0,0,0,0.6);
          animation: introRise 0.9s cubic-bezier(0.22, 1, 0.36, 1) ${HOLD + 2700}ms both;
        }
      `}</style>

      <div className="introStage" aria-hidden="true">
        <div className="introGrid">
          {tiles.map((tile, i) => (
            <div key={i} className={`introTile${tile.wide ? " is-wide" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/${tile.src}.webp`} alt="" draggable={false} />
            </div>
          ))}
        </div>
      </div>
      <div className="introVignette" />

      <div className="introContent">
        <div className="introTitle">
          {t("egressTaglinePrefix")} <span className="introVibra">Vibra.</span>
        </div>

        <div className="introMoment">Tu momento con {name}</div>

        <div className="introAvatar" style={{ width: OUTER, height: OUTER }}>
          <svg
            className="introRing"
            width={OUTER}
            height={OUTER}
            style={{ position: "absolute", inset: 0, display: "block", transform: "rotate(-90deg)" }}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="introRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ec4899" />
                <stop offset="52%" stopColor="#9333ea" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
            </defs>
            <circle
              cx={OUTER / 2}
              cy={OUTER / 2}
              r={r}
              fill="none"
              stroke="url(#introRingGrad)"
              strokeWidth={RING_W}
              strokeLinecap="round"
            />
          </svg>
          <div
            style={{
              position: "absolute",
              top: GAP + RING_W,
              insetInlineStart: GAP + RING_W,
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
              <span style={{ color: "#fff", fontWeight: 700, fontSize: Math.round(AVATAR * 0.4) }}>
                {initials}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="introDomain">{BRAND_DOMAIN}</div>
    </div>
  );
}
