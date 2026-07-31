"use client";

// Skeletons de lista para el wallet: cards (lives/tickets) y filas de
// suscriptores. Reutilizan la base canónica de la plataforma (`.vb-skel` +
// onda `vbSkelWave`, ver vibra_style.md). Scoped con styled-jsx.

// N cards apiladas (mismo alto/redondeo que las cards de lives y tickets).
export function WalletCardsSkeleton({
  count = 4,
  height = 66,
}: {
  count?: number;
  height?: number;
}) {
  return (
    <div className="vb-cards-skel" aria-hidden="true">
      <style jsx>{`
        .vb-cards-skel {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
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
        .vb-card-skel {
          width: 100%;
          border-radius: 14px;
        }
      `}</style>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="vb-skel vb-card-skel" style={{ height }} />
      ))}
    </div>
  );
}

// N filas de suscriptor (avatar circular + nombre + antigüedad).
export function WalletSubscriberRowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="vb-subrows-skel" aria-hidden="true">
      <style jsx>{`
        .vb-subrows-skel {
          display: flex;
          flex-direction: column;
          margin-top: 10px;
        }
        .vb-subrow {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 9px 0;
        }
        .vb-subrow + .vb-subrow {
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
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
        .vb-subrow-avatar {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .vb-subrow-name {
          height: 12px;
          border-radius: 6px;
          flex: 1;
          max-width: 150px;
        }
        .vb-subrow-tenure {
          height: 11px;
          border-radius: 6px;
          width: 52px;
          flex-shrink: 0;
        }
      `}</style>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="vb-subrow">
          <div className="vb-skel vb-subrow-avatar" />
          <div className="vb-skel vb-subrow-name" />
          <div className="vb-skel vb-subrow-tenure" />
        </div>
      ))}
    </div>
  );
}
