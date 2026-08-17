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
  trailing,
  padding = "10px 14px",
}: {
  rows?: number;
  avatarSize?: number;
  /**
   * Los avisos y el menú llevan círculo; las experiencias, miniatura cuadrada;
   * `none` es para la lista que no tiene figura a la izquierda y arranca en el
   * texto.
   */
  avatarShape?: "circle" | "square" | "none";
  maxWidth?: number;
  /**
   * Ancho del bloque que va al final del renglón, para las listas cuya fila
   * termina en un botón —revocar una sesión, desbloquear una cuenta—. Sin esto
   * el hueco quedaría corto justo del lado donde el usuario va a apuntar.
   */
  trailing?: number;
  /**
   * Margen interior del bloque. Se puede poner en `0` cuando el skeleton va
   * dentro de un panel que ya trae el suyo, para que no se acumulen.
   */
  padding?: string;
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
          padding: ${padding};
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
        .vb-list-trailing {
          width: ${trailing ?? 0}px;
          height: 36px;
          border-radius: 6px;
          flex-shrink: 0;
        }
      `}</style>

      {Array.from({ length: rows }).map((_, i) => (
        <div className="vb-list-row" key={i}>
          {avatarShape === "none" ? null : (
            <div className="vb-skel vb-list-avatar" />
          )}
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
          {trailing ? <div className="vb-skel vb-list-trailing" /> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton de lista de cards: N bloques apilados del alto de la card real.
 *
 * Es la otra forma que se repite en el producto —experiencias, sesiones,
 * compras, movimientos del wallet—: filas que no son avatar + texto sino una
 * tarjeta entera. Reproducir su contenido por dentro no aporta nada mientras
 * carga; lo que importa es que el bloque mida lo que va a medir.
 */
export function CardsSkeleton({
  count = 4,
  height = 66,
  radius = 14,
  gap = 10,
}: {
  count?: number;
  height?: number;
  radius?: number;
  gap?: number;
}) {
  return (
    <div className="vb-cards-skel" aria-hidden="true">
      <style jsx>{`
        .vb-skel {
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
        .vb-cards-skel {
          display: flex;
          flex-direction: column;
          gap: ${gap}px;
          width: 100%;
        }
        .vb-card-skel {
          width: 100%;
          height: ${height}px;
          border-radius: ${radius}px;
        }
      `}</style>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="vb-skel vb-card-skel" />
      ))}
    </div>
  );
}
