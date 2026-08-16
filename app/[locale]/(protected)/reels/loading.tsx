/**
 * Reels. No lleva filas ni tarjetas: el reel ocupa la pantalla entera, así que
 * el fallback es un solo bloque a pantalla completa con la misma onda que el
 * resto de los skeletons. Dibujar aquí una lista mentiría sobre lo que viene.
 */
export default function Loading() {
  return (
    <main
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        background: "#000",
        overflow: "hidden",
      }}
    >
      <div className="vb-reel-skel" aria-hidden="true" />
      <style>{`
        .vb-reel-skel {
          position: absolute;
          inset: 0;
          background-color: rgba(255, 255, 255, 0.06);
          background-image: linear-gradient(
            100deg,
            rgba(255, 255, 255, 0.04) 30%,
            rgba(255, 255, 255, 0.09) 50%,
            rgba(255, 255, 255, 0.04) 70%
          );
          background-size: 300% 100%;
          animation: vbSkelWave 1.6s ease-in-out infinite;
        }
        @keyframes vbSkelWave {
          0%   { background-position: 180% 0; }
          100% { background-position: -80% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .vb-reel-skel {
            animation: none;
            background: rgba(255, 255, 255, 0.06);
          }
        }
      `}</style>
    </main>
  );
}
