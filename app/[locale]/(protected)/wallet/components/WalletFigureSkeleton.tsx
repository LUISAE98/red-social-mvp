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
        .vb-wallet-figure-skel {
          display: inline-block;
          border-radius: 6px;
          vertical-align: middle;
        }
      `}</style>
    </span>
  );
}
