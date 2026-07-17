"use client";

// Overlay "horneado" de la grabación: avatar del creador con aro de Vibra +
// nombre + tipo de experiencia, arriba a la izquierda.
//
// Vive aparte de la plantilla (page.tsx) porque lo consumen DOS sitios y debe
// ser la misma fuente en ambos:
//   · la plantilla real de grabación (app/[locale]/egress/session/page.tsx)
//   · el lienzo de diseño 1920×1080 (app/[locale]/dev/video-icons)
//
// (Antes el lienzo tenía una COPIA manual de este badge, con un comentario
// "Fuente: page.tsx". Se podían desincronizar sin que nadie se enterara.)
//
// Se renderiza a 1080p nativo (px absolutos, nítido) y el grabador lo captura
// dentro del video. Sin marca de vibraon.com: ésa va en el cierre.

const TYPE_LABEL: Record<string, string> = {
  meet_greet: "Tiempo contigo",
  exclusive_session: "Sesión exclusiva",
};

// Cuándo entra el overlay, contado desde que monta la plantilla (= desde que el
// grabador se conecta, el mismo cero que el intro):
//   6.2s  termina el intro y se ve la sesión
//   +5s   la esquina se queda LIMPIA a propósito
//   11.2s entra el overlay
export const OVERLAY_IN_AT = 11200;

export default function SessionOverlay({
  avatarUrl,
  name,
  type,
  out = false,
  startDelay = OVERLAY_IN_AT,
}: {
  avatarUrl: string | null;
  name: string;
  type: string;
  // true → toca salir (t=-5 en el cierre por reloj; al instante en cancelación).
  out?: boolean;
  // Sólo para el lienzo de diseño, que no espera 11s para iterar la animación.
  startDelay?: number;
}) {
  const typeLabel = TYPE_LABEL[type] ?? "";
  const initials = (name || "?").trim().charAt(0).toUpperCase();

  const AVATAR = 104;
  const RING_W = 7;
  const GAP = 5; // hueco TRANSPARENTE entre el avatar y el aro (deja ver el video)
  const OUTER = AVATAR + 2 * GAP + 2 * RING_W;
  const r = (OUTER - RING_W) / 2;
  const C = 2 * Math.PI * r;

  return (
    <div className={`vsoRoot${out ? " is-out" : ""}`}>
      <style>{`
        .vsoRoot {
          position: absolute; top: 34px; left: 34px; z-index: 20;
          display: flex; align-items: center; gap: 16px;
          pointer-events: none;
        }

        /* ── ENTRADA ──────────────────────────────────────────────────────
           Mismo lenguaje que el intro: pop con rebote y el aro dibujándose
           como si cargara. Con \`both\`, antes del delay queda invisible — por
           eso la esquina se ve limpia los 5s previos. */
        .vsoAvatar {
          position: relative; flex-shrink: 0;
          filter: drop-shadow(0 4px 14px rgba(0,0,0,0.5));
          animation: vsoPop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) ${startDelay}ms both;
        }
        @keyframes vsoPop {
          from { opacity: 0; transform: scale(0.4); }
          to   { opacity: 1; transform: scale(1); }
        }

        .vsoRing circle {
          stroke-dasharray: ${C};
          stroke-dashoffset: ${C};
          animation: vsoRingDraw 1.7s cubic-bezier(0.65, 0, 0.35, 1) ${startDelay + 200}ms both;
        }
        @keyframes vsoRingDraw { to { stroke-dashoffset: 0; } }

        .vsoName {
          animation: vsoTextIn 0.7s cubic-bezier(0.22, 1, 0.36, 1) ${startDelay + 420}ms both;
        }
        .vsoType {
          animation: vsoTextIn 0.7s cubic-bezier(0.22, 1, 0.36, 1) ${startDelay + 560}ms both;
        }
        @keyframes vsoTextIn {
          from { opacity: 0; transform: translateX(-14px); filter: blur(6px); }
          to   { opacity: 1; transform: translateX(0); filter: blur(0); }
        }

        /* ── SALIDA ───────────────────────────────────────────────────────
           La entrada al revés: el aro se "descarga", los textos salen
           deslizando hacia la esquina y el avatar se encoge al final.
           Dura ~1s: entra de sobra en los 5s de aviso del cierre por reloj y
           también en los 2.6s que tarda el negro de la cancelación. */
        .vsoRoot.is-out .vsoRing circle {
          animation: vsoRingUndraw 0.8s cubic-bezier(0.65, 0, 0.35, 1) 0ms both;
        }
        @keyframes vsoRingUndraw {
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: ${C}; }
        }

        .vsoRoot.is-out .vsoName,
        .vsoRoot.is-out .vsoType {
          animation: vsoTextOut 0.5s cubic-bezier(0.4, 0, 1, 1) 0ms both;
        }
        .vsoRoot.is-out .vsoType { animation-delay: 80ms; }
        @keyframes vsoTextOut {
          from { opacity: 1; transform: translateX(0); }
          to   { opacity: 0; transform: translateX(-12px); filter: blur(4px); }
        }

        .vsoRoot.is-out .vsoAvatar {
          animation: vsoPopOut 0.7s cubic-bezier(0.4, 0, 0.2, 1) 300ms both;
        }
        @keyframes vsoPopOut {
          from { opacity: 1; transform: scale(1); }
          to   { opacity: 0; transform: scale(0.72); }
        }
      `}</style>

      <div className="vsoAvatar" style={{ width: OUTER, height: OUTER }}>
        {/* Aro de Vibra como anillo real: centro y hueco transparentes */}
        <svg
          className="vsoRing"
          width={OUTER}
          height={OUTER}
          style={{ position: "absolute", inset: 0, display: "block", transform: "rotate(-90deg)" }}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="vibraRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
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
            stroke="url(#vibraRingGrad)"
            strokeWidth={RING_W}
            strokeLinecap="round"
          />
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
        <span
          className="vsoName"
          style={{ color: "#fff", fontWeight: 700, fontSize: 37, letterSpacing: "-0.01em", textShadow: "0 2px 10px rgba(0,0,0,0.7)", lineHeight: 1.1 }}
        >
          {name}
        </span>
        {typeLabel ? (
          <span
            className="vsoType"
            style={{ color: "rgba(255,255,255,0.88)", fontWeight: 500, fontSize: 27, textShadow: "0 2px 10px rgba(0,0,0,0.7)", lineHeight: 1.1 }}
          >
            {typeLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
