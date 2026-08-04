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
        .vb-hdr-cover {
          width: 100%;
          height: ${COVER_H};
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
        .vb-hdr-stats {
          width: min(50%, 180px);
          height: 12px;
          border-radius: 6px;
          margin-top: 14px;
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

      <div className="vb-skel vb-hdr-cover" />
      <div className="vb-hdr-body">
        <div className="vb-skel vb-hdr-avatar" />
        <div className="vb-skel vb-hdr-name" />
        <div className="vb-skel vb-hdr-handle" />
        <div className="vb-skel vb-hdr-bio-1" />
        <div className="vb-skel vb-hdr-bio-2" />
        <div className="vb-skel vb-hdr-stats" />
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
