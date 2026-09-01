"use client";

/**
 * Una sola forma de esqueleto, con el relleno canónico de la plataforma.
 *
 * `ListSkeleton` y `PostSkeleton` resuelven una lista y una tarjeta, que son
 * formas cerradas. Esto es la pieza suelta, para los huecos que no forman lista:
 * el avatar sobre el video del reel, el renglón del nombre, el botón que aún no
 * se sabe si va a existir.
 *
 * El relleno y la onda son los de `vibra_style.md` y no se tocan; lo único que
 * cambia por sitio es la forma.
 */
export default function SkeletonBlock({
  width,
  height,
  radius = 6,
  circle = false,
  style,
}: {
  width?: number | string;
  height: number | string;
  radius?: number | string;
  circle?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="vb-skel"
      aria-hidden="true"
      style={{
        display: "block",
        width: width ?? "100%",
        height,
        borderRadius: circle ? "50%" : radius,
        flexShrink: 0,
        ...style,
      }}
    >
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
      `}</style>
    </span>
  );
}
