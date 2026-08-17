"use client";

// Skeleton del encabezado de perfil/comunidad mientras cargan los datos (reemplaza
// el spinner). Reproduce la forma del header: portada, avatar solapado, nombre,
// handle, descripción, stats, botón, historias y cards de servicios.
//
// Usa la base canónica de vibra_style.md: relleno .vb-skel + onda vbSkelWave
// (con fallback de color sólido y respeto a prefers-reduced-motion).
export default function ProfileHeaderSkeleton({
  maxWidth = 1080,
  storyCount = 6,
  cardCount = 3,
}: {
  maxWidth?: number;
  storyCount?: number;
  cardCount?: number;
}) {
  const COVER_H = "clamp(240px, 38vw, 360px)";
  const AVATAR = "clamp(112px, 24vw, 220px)";

  return (
    <div className="vb-hdr-skel" aria-hidden="true">
      <style jsx>{`
        .vb-skel {
          /* Color base sólido por si el gradiente/animación no pinta (fallback). */
          background-color: rgba(255, 255, 255, 0.08);
          background-image: linear-gradient(
            100deg,
            rgba(255, 255, 255, 0.05) 30%,
            rgba(255, 255, 255, 0.11) 50%,
            rgba(255, 255, 255, 0.05) 70%
          );
          background-size: 300% 100%;
          animation: vbSkelWave 1.6s ease-in-out infinite;
        }
        @keyframes vbSkelWave {
          0% {
            background-position: 180% 0;
          }
          100% {
            background-position: -80% 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .vb-skel {
            animation: none;
            background: rgba(255, 255, 255, 0.07);
          }
        }

        .vb-hdr-skel {
          width: 100%;
          max-width: ${maxWidth}px;
          margin: 0 auto;
          box-sizing: border-box;
        }
        .vb-hdr-cover-wrap {
          position: relative;
          width: 100%;
        }
        .vb-hdr-cover {
          width: 100%;
          height: ${COVER_H};
          /* Esquinas superiores redondeadas, igual que la card real (radio 18). */
          border-radius: 18px 18px 0 0;
        }
        @media (max-width: 640px) {
          .vb-hdr-cover {
            border-radius: 0;
          }
        }
        /* Difuminado inferior a negro, igual que el overlay de la portada real. */
        .vb-hdr-cover-fade {
          position: absolute;
          inset-inline-start: 0;
          inset-inline-end: 0;
          bottom: 0;
          height: 48%;
          background: linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0) 0%,
            rgba(0, 0, 0, 0.55) 55%,
            #000 100%
          );
          pointer-events: none;
        }
        .vb-hdr-body {
          padding: 0 18px 8px;
          display: grid;
          place-items: center;
          text-align: center;
        }
        @media (max-width: 640px) {
          .vb-hdr-body {
            padding: 0 12px 8px;
          }
        }
        .vb-hdr-avatar {
          width: ${AVATAR};
          height: ${AVATAR};
          border-radius: 50%;
          margin-top: calc(${AVATAR} / -2);
          border: 4px solid #000;
          /* Base OPACA (no rgba translúcido): así no se ve la portada detrás.
             Se mantiene la onda shimmer de .vb-skel encima de este sólido. */
          background-color: #161616;
          z-index: 1;
        }
        .vb-hdr-name {
          width: min(60%, 220px);
          height: 26px;
          border-radius: 7px;
          margin-top: 14px;
        }
        .vb-hdr-handle {
          width: min(38%, 130px);
          height: 15px;
          border-radius: 6px;
          margin-top: 10px;
        }
        .vb-hdr-bio-1 {
          width: min(84%, 420px);
          height: 12px;
          border-radius: 6px;
          margin-top: 16px;
        }
        .vb-hdr-bio-2 {
          width: min(64%, 320px);
          height: 12px;
          border-radius: 6px;
          margin-top: 8px;
        }
        /* Los tres datos de la portada. Reproduce la geometría de StatsRow
           (components/ui/StatsRow.tsx) desde la MISMA escala: tres columnas
           iguales, la primera de un solo renglón centrado a lo alto —el tipo de
           perfil o de comunidad, que no lleva cifra— y las otras dos con cifra
           arriba y palabra abajo. Así el hueco que reserva el skeleton es el que
           va a ocupar la fila real y nada salta cuando llegan los datos. */
        .vb-hdr-stats {
          --vb-stat-scale: 1.2;
          width: 100%;
          max-width: calc(460px * var(--vb-stat-scale));
          margin-top: calc(18px * var(--vb-stat-scale));
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .vb-hdr-stat {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          min-width: 0;
          padding: calc(2px * var(--vb-stat-scale))
            calc(14px * var(--vb-stat-scale));
        }
        @media (max-width: 430px) {
          .vb-hdr-stat {
            padding-inline: calc(4px * var(--vb-stat-scale));
          }
        }
        /* La misma línea que divide en la fila real, pero apagada: aquí es parte
           del relleno y no debe leerse como un dato ya cargado. */
        .vb-hdr-stat + .vb-hdr-stat::before {
          content: "";
          position: absolute;
          inset-inline-start: 0;
          top: calc(2px * var(--vb-stat-scale));
          width: 1px;
          height: calc(40px * var(--vb-stat-scale));
          background: linear-gradient(
            to bottom,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.16) 22%,
            rgba(255, 255, 255, 0.16) 78%,
            rgba(255, 255, 255, 0) 100%
          );
        }
        .vb-hdr-stat-line {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
        }
        /* Solo el primer renglón lleva altura fija, igual que en la fila real:
           es lo que hace que el de abajo arranque parejo en las tres columnas. */
        .vb-hdr-stat-line:first-child {
          min-height: calc(20px * var(--vb-stat-scale));
        }
        /* 11px de la palabra por su interlineado de 1.2. */
        .vb-hdr-stat-line + .vb-hdr-stat-line {
          min-height: calc(13.2px * var(--vb-stat-scale));
        }
        /* La columna de un solo renglón se centra a lo alto contra las otras
           dos, no se queda colgando de arriba. */
        .vb-hdr-stat--single {
          justify-content: center;
        }
        .vb-hdr-stat--single .vb-hdr-stat-line:first-child {
          min-height: 0;
        }
        .vb-hdr-stat-pair {
          width: min(80%, 84px);
          height: 12px;
          border-radius: 6px;
        }
        .vb-hdr-stat-value {
          width: min(60%, 54px);
          height: 15px;
          border-radius: 6px;
        }
        .vb-hdr-stat-word {
          width: min(88%, 78px);
          height: 10px;
          border-radius: 5px;
        }
        .vb-hdr-btn {
          width: 100%;
          max-width: 360px;
          height: 44px;
          border-radius: 14px;
          margin-top: 18px;
        }
        .vb-hdr-stories {
          width: 100%;
          display: flex;
          gap: 14px;
          margin-top: 22px;
          justify-content: flex-start;
          overflow: hidden;
        }
        .vb-hdr-story {
          width: 62px;
          height: 62px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .vb-hdr-cards {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 22px;
        }
        .vb-hdr-card {
          width: 100%;
          height: 76px;
          border-radius: 0;
        }
      `}</style>

      <div className="vb-hdr-cover-wrap">
        <div className="vb-skel vb-hdr-cover" />
        <div className="vb-hdr-cover-fade" />
      </div>
      <div className="vb-hdr-body">
        <div className="vb-skel vb-hdr-avatar" />
        <div className="vb-skel vb-hdr-name" />
        <div className="vb-skel vb-hdr-handle" />
        <div className="vb-skel vb-hdr-bio-1" />
        <div className="vb-skel vb-hdr-bio-2" />
        <div className="vb-hdr-stats">
          {/* El tipo de perfil o de comunidad: un renglón, sin cifra. */}
          <div className="vb-hdr-stat vb-hdr-stat--single">
            <div className="vb-hdr-stat-line">
              <div className="vb-skel vb-hdr-stat-pair" />
            </div>
          </div>
          {/* Seguidores/miembros y publicaciones: cifra arriba, palabra abajo. */}
          {[0, 1].map((i) => (
            <div key={i} className="vb-hdr-stat">
              <div className="vb-hdr-stat-line">
                <div className="vb-skel vb-hdr-stat-value" />
              </div>
              <div className="vb-hdr-stat-line">
                <div className="vb-skel vb-hdr-stat-word" />
              </div>
            </div>
          ))}
        </div>
        <div className="vb-skel vb-hdr-btn" />
        <div className="vb-hdr-stories">
          {Array.from({ length: storyCount }).map((_, i) => (
            <div key={i} className="vb-skel vb-hdr-story" />
          ))}
        </div>
        <div className="vb-hdr-cards">
          {Array.from({ length: cardCount }).map((_, i) => (
            <div key={i} className="vb-skel vb-hdr-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
