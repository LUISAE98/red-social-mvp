"use client";

/**
 * Skeleton de lista genérico: filas de avatar + dos líneas de texto.
 *
 * Es la forma que comparten las pantallas de lista del producto —avisos, menú,
 * experiencias, seguidores— y no vale la pena un skeleton a medida para cada
 * una: lo que importa durante una navegación es que el hueco tenga el peso y el
 * ritmo correctos, no que reproduzca cada detalle.
 *
 * Usa la base canónica de vibra_style.md (relleno `.vb-skel` + onda `vbSkelWave`,
 * con fallback sólido y respeto a `prefers-reduced-motion`).
 */
export default function ListSkeleton({
  rows = 6,
  avatarSize = 44,
  avatarShape = "circle",
  maxWidth = 720,
}: {
  rows?: number;
  avatarSize?: number;
  /** Los avisos y el menú llevan círculo; las experiencias, miniatura cuadrada. */
  avatarShape?: "circle" | "square";
  maxWidth?: number;
}) {
  return (
    <div className="vb-list-skel" aria-hidden="true">
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

        .vb-list-skel {
          width: 100%;
          max-width: ${maxWidth}px;
          margin: 0 auto;
          padding: 10px 14px;
          box-sizing: border-box;
        }
        .vb-list-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 0;
        }
        .vb-list-avatar {
          width: ${avatarSize}px;
          height: ${avatarSize}px;
          border-radius: ${avatarShape === "circle" ? "50%" : "12px"};
          flex-shrink: 0;
        }
        .vb-list-lines {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .vb-list-line-1 {
          height: 13px;
          border-radius: 6px;
        }
        .vb-list-line-2 {
          height: 11px;
          border-radius: 6px;
        }
      `}</style>

      {Array.from({ length: rows }).map((_, i) => (
        <div className="vb-list-row" key={i}>
          <div className="vb-skel vb-list-avatar" />
          <div className="vb-list-lines">
            {/* Anchos fijos por posición y no aleatorios: con Math.random cada
                render daría un ancho distinto y la onda parecería saltar. */}
            <div
              className="vb-skel vb-list-line-1"
              style={{ width: `${[68, 52, 74, 46, 61, 57, 70, 49][i % 8]}%` }}
            />
            <div
              className="vb-skel vb-list-line-2"
              style={{ width: `${[40, 33, 47, 28, 38, 30, 43, 35][i % 8]}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
