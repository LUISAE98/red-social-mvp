"use client";

export default function VibraGlobalBackground() {
  return (
    <>
      <style jsx global>{`
        .vibraGlobalBackground {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
          background-image:
            linear-gradient(rgba(0,0,0,0.18), rgba(0,0,0,0.18)),
            url("/background-vibra.png");
          background-size: cover;
          background-position: center bottom;
          background-repeat: no-repeat;
          transform: translate3d(0, 0, 0) scaleX(1) scaleY(1);
          transform-origin: center bottom;
          animation: vibraGlobalBackgroundSoftWave 18s ease-in-out infinite;
          will-change: transform;
        }

        @keyframes vibraGlobalBackgroundSoftWave {
          0%, 100% {
            transform: translate3d(0, 0, 0) scaleX(1) scaleY(1);
          }

          50% {
            transform: translate3d(0, 2px, 0) scaleX(1.006) scaleY(0.988);
          }
        }

        .vibraGlobalColorFilter {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background:
            linear-gradient(
              115deg,
              transparent 0%,
              rgba(79, 70, 255, 0.08) 36%,
              rgba(168, 85, 255, 0.075) 50%,
              rgba(255, 47, 179, 0.08) 64%,
              transparent 100%
            );
          mix-blend-mode: screen;
          opacity: 0.45;
          animation: vibraGlobalColorFlow 9s ease-in-out infinite;
        }

        @keyframes vibraGlobalColorFlow {
          0%, 100% {
            transform: translateX(-8%);
            opacity: 0.28;
          }

          50% {
            transform: translateX(8%);
            opacity: 0.5;
          }
        }

        .vibraGlobalParticles {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
        }

        .vibraGlobalParticle {
          position: absolute;
          border-radius: 999px;
          animation: vibraGlobalParticleFloat 8s ease-in-out infinite;
        }

        .vibraGlobalParticle.isGlowing::before {
          content: "";
          position: absolute;
          inset: -180%;
          border-radius: inherit;
          background: inherit;
          filter: blur(5px);
          opacity: 0.28;
        }

        .vibraGlobalParticle.isGlowing::after {
          content: "";
          position: absolute;
          inset: -320%;
          border-radius: inherit;
          background: inherit;
          filter: blur(9px);
          opacity: 0.09;
        }

        @keyframes vibraGlobalParticleFloat {
          0%, 100% {
            transform: translate3d(0, 0, 0);
            opacity: 0.35;
          }

          50% {
            transform: translate3d(12px, -18px, 0);
            opacity: 1;
          }
        }
      `}</style>

      <div className="vibraGlobalBackground" aria-hidden="true" />
      <div className="vibraGlobalColorFilter" aria-hidden="true" />

      <div className="vibraGlobalParticles" aria-hidden="true">
        {Array.from({ length: 86 }).map((_, index) => {
          const randomA = Math.abs(Math.sin(index * 12.9898) * 43758.5453) % 1;
          const randomB = Math.abs(Math.sin(index * 78.233) * 24634.6345) % 1;
          const randomC = Math.abs(Math.sin(index * 39.425) * 12983.445) % 1;

          const isLowerParticle = index < 68;

          const left = randomA * 100;
          const top = isLowerParticle ? 50 + randomB * 46 : 4 + randomB * 36;

          const color =
            left > 62
              ? "rgba(79, 70, 255, 0.9)"
              : left > 38
                ? "rgba(168, 85, 255, 0.92)"
                : "rgba(255, 47, 179, 0.95)";

          const glow =
            left > 62
              ? "rgba(79, 70, 255, 0.9)"
              : left > 38
                ? "rgba(168, 85, 255, 0.9)"
                : "rgba(255, 47, 179, 0.95)";

          const size = isLowerParticle ? 2 + randomC * 4.2 : 1.4 + randomC * 2.2;

          return (
            <span
              key={index}
              className={`vibraGlobalParticle ${randomC > 0.93 ? "isGlowing" : ""}`}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: size,
                height: size,
                background: color,
                boxShadow:
                  randomC > 0.93
                    ? `0 0 ${size * 1.8}px ${glow}`
                    : `0 0 ${size * 0.8}px ${glow}`,
                filter:
                  randomC > 0.93
                    ? `brightness(${1.12 + randomB * 0.18})`
                    : "brightness(1)",
                animationDelay: `${randomB * 4}s`,
                animationDuration: `${7 + randomC * 6}s`,
                opacity:
                  randomA > 0.72
                    ? 0.82
                    : isLowerParticle
                      ? 0.38 + randomC * 0.22
                      : 0.08 + randomC * 0.12,
              }}
            />
          );
        })}
      </div>
    </>
  );
}