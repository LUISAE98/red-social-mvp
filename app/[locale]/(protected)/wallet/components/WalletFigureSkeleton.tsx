"use client";

// Skeleton para las cifras del wallet mientras cargan sus datos variables.
// Reutiliza la base canónica de la plataforma (clase `.vb-skel` + onda
// `vbSkelWave`, definidas en vibra_style.md), solo que con la forma de una
// cifra (una línea/bloque). Scoped con styled-jsx.
export default function WalletFigureSkeleton({
  width = 90,
  height = 17,
}: {
  width?: number | string;
  height?: number;
}) {
  return (
    <span
      className="vb-skel vb-wallet-figure-skel"
      style={{ width, height }}
      aria-hidden="true"
    >
      <style jsx>{`
        .vb-skel {
          background: linear-gradient(
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
        .vb-wallet-figure-skel {
          display: inline-block;
          border-radius: 6px;
          vertical-align: middle;
        }
      `}</style>
    </span>
  );
}
